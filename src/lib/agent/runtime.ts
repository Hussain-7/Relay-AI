import crypto from "node:crypto";
import {
  ExecutionTarget,
  Prisma,
  ProviderId,
  RunMode,
  RunStatus,
  ServerType,
  type AgentRun,
  type MCPServer,
} from "@prisma/client";
import { generateText, tool, type ToolSet } from "ai";
import { Octokit } from "octokit";
import { z } from "zod";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { buildCustomToolsForUser } from "@/lib/custom-tool-runtime";
import {
  connectSandbox,
  createSandbox,
  execInSandbox,
  type ExecCommandResult,
} from "@/lib/e2b-runtime";
import { createInstallationToken } from "@/lib/github-app";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";
import { selectModelForUser, type SelectedModel } from "@/lib/model-selection";
import { getActiveProviderCredentials } from "@/lib/provider-credentials";
import { ensureToolApprovedOrRequest } from "@/lib/tool-approvals";
import { webSearch } from "@/lib/web-search";

function modeToExecutionTarget(mode: RunMode): ExecutionTarget {
  return mode === RunMode.CODING ? ExecutionTarget.E2B : ExecutionTarget.VERCEL;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeRepoFullName(repoFullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error("Invalid repo_full_name. Expected owner/repo");
  }

  return { owner, repo };
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function previewUnknown(value: unknown, maxChars = 500): unknown {
  if (typeof value === "string") {
    return truncate(value, maxChars);
  }

  if (typeof value === "object" && value !== null) {
    return truncate(JSON.stringify(value), maxChars);
  }

  return value;
}

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+\/(\s|$)/i,
  /\bmkfs\./i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkillall\s+-9\b/i,
];

function assertCommandAllowed(command: string): void {
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Forbidden command pattern detected: ${pattern}`);
    }
  }
}

async function ensureRunNotCancelled(runId: string): Promise<void> {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { cancelledAt: true, status: true },
  });

  if (!run) {
    throw new Error("Run not found");
  }

  if (run.cancelledAt || run.status === RunStatus.CANCELLED) {
    throw new Error("Run was cancelled");
  }
}

async function ensureCodingSession(userId: string, codingSessionId: string) {
  const session = await prisma.codingSession.findFirst({
    where: {
      id: codingSessionId,
      userId,
    },
  });

  if (!session) {
    throw new Error("Coding session not found");
  }

  return session;
}

async function resolveGithubInstallationId(
  userId: string,
): Promise<string | null> {
  const installation = await prisma.githubInstallation.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { installationId: true },
  });

  return installation?.installationId ?? null;
}

async function getGithubTokenForUser(userId: string): Promise<string | null> {
  const installationId = await resolveGithubInstallationId(userId);
  if (!installationId) {
    return null;
  }

  return createInstallationToken(installationId);
}

async function ensureSandboxForSession(params: {
  userId: string;
  codingSessionId: string;
  timeoutMs?: number;
}) {
  const { userId, codingSessionId, timeoutMs = 1_800_000 } = params;
  const session = await ensureCodingSession(userId, codingSessionId);

  if (session.sandboxId) {
    const sandbox = await connectSandbox(session.sandboxId);
    await sandbox.setTimeout(timeoutMs);

    return {
      codingSessionId,
      sandboxId: session.sandboxId,
      status: "connected" as const,
      repoFullName: session.repoFullName,
      workingBranch: session.workingBranch,
      baseBranch: session.baseBranch,
    };
  }

  const sandbox = await createSandbox(timeoutMs, {
    userId,
    codingSessionId,
  });

  const updated = await prisma.codingSession.update({
    where: { id: codingSessionId },
    data: {
      sandboxId: sandbox.sandboxId,
      status: "connected",
    },
  });

  return {
    codingSessionId,
    sandboxId: updated.sandboxId!,
    status: "created" as const,
    repoFullName: updated.repoFullName,
    workingBranch: updated.workingBranch,
    baseBranch: updated.baseBranch,
  };
}

async function runSessionCommand(params: {
  userId: string;
  codingSessionId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envs?: Record<string, string>;
}): Promise<ExecCommandResult> {
  const session = await ensureCodingSession(
    params.userId,
    params.codingSessionId,
  );
  if (!session.sandboxId) {
    throw new Error("Coding session is not connected to a sandbox");
  }

  return execInSandbox(session.sandboxId, {
    command: params.command,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    envs: params.envs,
  });
}

function toExecCommandResult(params: {
  command: string;
  cwd?: string;
  result: {
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
  };
}): ExecCommandResult {
  return {
    command: params.command,
    cwd: params.cwd,
    stdout: params.result.stdout,
    stderr: params.result.stderr,
    exitCode: params.result.exitCode,
    error: params.result.error,
  };
}

async function runSessionGitClone(params: {
  userId: string;
  codingSessionId: string;
  url: string;
  destination: string;
  branch?: string;
  depth?: number;
  username?: string;
  password?: string;
  timeoutMs?: number;
}): Promise<ExecCommandResult> {
  const session = await ensureCodingSession(params.userId, params.codingSessionId);
  if (!session.sandboxId) {
    throw new Error("Coding session is not connected to a sandbox");
  }

  const sandbox = await connectSandbox(session.sandboxId);
  const result = await sandbox.git.clone(params.url, {
    path: params.destination,
    branch: params.branch,
    depth: params.depth ?? 1,
    username: params.username,
    password: params.password,
    timeoutMs: params.timeoutMs ?? 300_000,
  });

  return toExecCommandResult({
    command: `git clone ${params.url} ${params.destination}`,
    result,
  });
}

async function runSessionGitPush(params: {
  userId: string;
  codingSessionId: string;
  cwd: string;
  remote: string;
  branch: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}): Promise<ExecCommandResult> {
  const session = await ensureCodingSession(params.userId, params.codingSessionId);
  if (!session.sandboxId) {
    throw new Error("Coding session is not connected to a sandbox");
  }

  const sandbox = await connectSandbox(session.sandboxId);
  const result = await sandbox.git.push(params.cwd, {
    remote: params.remote,
    branch: params.branch,
    setUpstream: true,
    username: params.username,
    password: params.password,
    timeoutMs: params.timeoutMs ?? 180_000,
  });

  return toExecCommandResult({
    command: `git push -u ${params.remote} ${params.branch}`,
    cwd: params.cwd,
    result,
  });
}

async function readGitStatus(
  userId: string,
  codingSessionId: string,
  cwd = "/workspace/repo",
) {
  return runSessionCommand({
    userId,
    codingSessionId,
    command: "git status --short",
    cwd,
    timeoutMs: 45_000,
  });
}

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  if (lower === "localhost" || lower === "::1" || lower.endsWith(".internal")) {
    return true;
  }

  if (/^127\./.test(lower)) {
    return true;
  }

  if (/^10\./.test(lower)) {
    return true;
  }

  if (/^192\.168\./.test(lower)) {
    return true;
  }

  const match172 = /^172\.(\d{1,2})\./.exec(lower);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }

  if (/^169\.254\./.test(lower)) {
    return true;
  }

  return false;
}

async function safeHttpFetch(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBodyChars?: number;
}) {
  const parsed = new URL(input.url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Blocked private or local network host");
  }

  const timeoutMs = input.timeoutMs ?? 20_000;
  const maxBodyChars = input.maxBodyChars ?? 20_000;
  const method = (input.method ?? "GET").toUpperCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed.toString(), {
      method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal,
    });

    const body = truncate(await response.text(), maxBodyChars);

    return {
      ok: response.ok,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseApprovedMcpServerIds(approvedMcp: unknown): string[] {
  if (!approvedMcp || typeof approvedMcp !== "object") {
    return [];
  }

  const raw = (approvedMcp as { serverIds?: unknown }).serverIds;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === "string");
}

async function invokeApprovedRemoteMcpServer(
  server: MCPServer,
  toolName: string,
  args: Record<string, unknown>,
) {
  const config = (server.configJson ?? {}) as Record<string, unknown>;
  const url =
    typeof config.url === "string"
      ? config.url
      : typeof config.baseUrl === "string"
        ? config.baseUrl
        : "";

  if (!url) {
    throw new Error(`MCP server ${server.id} has no url/baseUrl in config`);
  }

  const method =
    typeof config.mcpMethod === "string" ? config.mcpMethod : "tools/call";
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (typeof config.bearerToken === "string" && config.bearerToken) {
    headers.authorization = `Bearer ${config.bearerToken}`;
  }

  if (typeof config.apiKey === "string" && config.apiKey) {
    const apiKeyHeader =
      typeof config.apiKeyHeader === "string"
        ? config.apiKeyHeader
        : "x-api-key";
    headers[apiKeyHeader] = config.apiKey;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function buildSystemPrompt(mode: RunMode): string {
  const base =
    "You are Endless Dev agent. Follow user instructions, use tools when useful, verify work, and return concise factual output.";

  if (mode === RunMode.CODING) {
    return `${base}\nCoding mode rules: prefer repo/e2b tools, run checks after edits, summarize diffs and test results.`;
  }

  if (mode === RunMode.AGENT) {
    return `${base}\nAgent mode rules: use web search and approved tools to produce reliable outcomes with source context.`;
  }

  return `${base}\nChat mode rules: answer directly unless the user explicitly requests tool use.`;
}

function mapStepSummary(step: unknown) {
  if (!step || typeof step !== "object") {
    return step;
  }

  const maybeStep = step as {
    text?: string;
    toolCalls?: Array<{ toolName?: string }>;
    toolResults?: Array<{ toolName?: string; result?: unknown }>;
  };

  return {
    text: maybeStep.text ?? null,
    toolCalls:
      maybeStep.toolCalls?.map((toolCall) => toolCall.toolName ?? "unknown") ??
      [],
    toolResults:
      maybeStep.toolResults?.map((toolResult) => ({
        toolName: toolResult.toolName ?? "unknown",
        resultPreview: previewUnknown(toolResult.result, 300),
      })) ?? [],
  };
}

type ToolSchema = z.ZodTypeAny;

function createTrackedTool<TSchema extends ToolSchema, TResult>(params: {
  runId: string;
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>) => Promise<TResult>;
}) {
  return tool({
    description: params.description,
    inputSchema: params.inputSchema as never,
    execute: (async (input: unknown) => {
      await appendRunEvent(params.runId, "tool.started", {
        toolName: params.name,
        input,
      });

      try {
        const result = await params.execute(input as z.infer<TSchema>);

        await appendRunEvent(params.runId, "tool.completed", {
          toolName: params.name,
          resultPreview: previewUnknown(result),
        });

        return result;
      } catch (error) {
        await appendRunEvent(params.runId, "tool.failed", {
          toolName: params.name,
          error: error instanceof Error ? error.message : String(error),
        });

        throw error;
      }
    }) as never,
  });
}

async function buildCoreTools(params: {
  userId: string;
  runId: string;
  mode: RunMode;
  approvedMcp: unknown;
}): Promise<ToolSet> {
  const tools: ToolSet = {
    web_search: createTrackedTool({
      runId: params.runId,
      name: "web_search",
      description: "Search the web and return top sources.",
      inputSchema: z.object({
        query: z.string().min(1),
        maxResults: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query, maxResults }) => {
        const results = await webSearch(query, maxResults);
        return {
          query,
          count: results.length,
          results,
        };
      },
    }),

    http_fetch: createTrackedTool({
      runId: params.runId,
      name: "http_fetch",
      description: "Fetch an HTTP/HTTPS URL with SSRF safeguards.",
      inputSchema: z.object({
        url: z.string().url(),
        method: z.string().optional(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(60_000).default(20_000),
        maxBodyChars: z.number().int().min(100).max(80_000).default(20_000),
      }),
      execute: async ({
        url,
        method,
        headers,
        body,
        timeoutMs,
        maxBodyChars,
      }) => {
        return safeHttpFetch({
          url,
          method,
          headers,
          body,
          timeoutMs,
          maxBodyChars,
        });
      },
    }),

    memory_put: createTrackedTool({
      runId: params.runId,
      name: "memory_put",
      description: "Persist a lightweight memory note.",
      inputSchema: z.object({
        key: z.string().min(1),
        value: z.string().min(1),
        scope: z.enum(["user", "run"]).default("user"),
      }),
      execute: async ({ key, value, scope }) => {
        const artifact = await prisma.artifact.create({
          data: {
            userId: params.userId,
            runId: scope === "run" ? params.runId : null,
            kind: "memory.note",
            storagePath: key,
            metaJson: {
              value,
              scope,
            },
          },
        });

        return {
          id: artifact.id,
          key,
          scope,
        };
      },
    }),

    memory_get: createTrackedTool({
      runId: params.runId,
      name: "memory_get",
      description: "Read the latest memory note by key.",
      inputSchema: z.object({
        key: z.string().min(1),
      }),
      execute: async ({ key }) => {
        const memory = await prisma.artifact.findFirst({
          where: {
            userId: params.userId,
            kind: "memory.note",
            storagePath: key,
          },
          orderBy: { createdAt: "desc" },
        });

        if (!memory) {
          return {
            found: false,
            key,
          };
        }

        return {
          found: true,
          key,
          value: (memory.metaJson as { value?: string })?.value ?? null,
          createdAt: memory.createdAt.toISOString(),
          runId: memory.runId,
        };
      },
    }),

    memory_search: createTrackedTool({
      runId: params.runId,
      name: "memory_search",
      description: "Search recent memory notes by text match.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ query, limit }) => {
        const rows = await prisma.artifact.findMany({
          where: {
            userId: params.userId,
            kind: "memory.note",
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        });

        const lowered = query.toLowerCase();
        const matches = rows
          .filter((row) => {
            const value = (row.metaJson as { value?: string })?.value ?? "";
            return (
              row.storagePath.toLowerCase().includes(lowered) ||
              value.toLowerCase().includes(lowered)
            );
          })
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            key: row.storagePath,
            value: (row.metaJson as { value?: string })?.value ?? null,
            createdAt: row.createdAt.toISOString(),
          }));

        return {
          count: matches.length,
          matches,
        };
      },
    }),

    artifacts_read: createTrackedTool({
      runId: params.runId,
      name: "artifacts_read",
      description:
        "Read stored artifacts for this user and optionally this run.",
      inputSchema: z.object({
        kind: z.string().optional(),
        runScoped: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ kind, runScoped, limit }) => {
        const artifacts = await prisma.artifact.findMany({
          where: {
            userId: params.userId,
            ...(kind ? { kind } : {}),
            ...(runScoped ? { runId: params.runId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        return {
          count: artifacts.length,
          artifacts: artifacts.map((artifact) => ({
            id: artifact.id,
            kind: artifact.kind,
            storagePath: artifact.storagePath,
            runId: artifact.runId,
            createdAt: artifact.createdAt.toISOString(),
            metaJson: artifact.metaJson,
          })),
        };
      },
    }),

    attachments_context: createTrackedTool({
      runId: params.runId,
      name: "attachments_context",
      description:
        "Normalize attachment metadata/content into prompt-safe text context.",
      inputSchema: z.object({
        attachments: z.array(
          z.object({
            name: z.string().optional(),
            type: z.string().optional(),
            content: z.string().optional(),
            url: z.string().url().optional(),
          }),
        ),
      }),
      execute: async ({ attachments }) => {
        const normalized = attachments.map((item, index) => {
          const title = item.name ?? `attachment_${index + 1}`;
          const type = item.type ?? "unknown";
          const source = item.url ? `url=${item.url}` : "inline";
          const content = item.content ? truncate(item.content, 1000) : "";
          return `[${title}] (${type}, ${source})\n${content}`;
        });

        return {
          count: attachments.length,
          context: normalized.join("\n\n"),
        };
      },
    }),
  };

  const approvedMcpServerIds = parseApprovedMcpServerIds(params.approvedMcp);
  const approvedMcpServers =
    approvedMcpServerIds.length > 0
      ? await prisma.mCPServer.findMany({
          where: {
            id: { in: approvedMcpServerIds },
            userId: params.userId,
            status: "active",
          },
        })
      : [];

  if (
    approvedMcpServers.some((server) => server.serverType === ServerType.REMOTE)
  ) {
    tools.mcp_remote_call = createTrackedTool({
      runId: params.runId,
      name: "mcp_remote_call",
      description: "Call an approved remote MCP server tool by name.",
      inputSchema: z.object({
        serverId: z.string().min(1),
        toolName: z.string().min(1),
        args: z.record(z.any()).default({}),
      }),
      execute: async ({ serverId, toolName, args }) => {
        const server = approvedMcpServers.find(
          (item) =>
            item.id === serverId && item.serverType === ServerType.REMOTE,
        );

        if (!server) {
          throw new Error(
            "Requested MCP server is not approved/available as remote",
          );
        }

        return invokeApprovedRemoteMcpServer(server, toolName, args);
      },
    });
  }

  if (params.mode !== RunMode.CODING) {
    return tools;
  }

  const localMcpServers = approvedMcpServers.filter(
    (server) => server.serverType === ServerType.LOCAL,
  );
  if (localMcpServers.length > 0) {
    tools.mcp_local_preflight = createTrackedTool({
      runId: params.runId,
      name: "mcp_local_preflight",
      description:
        "Prepare an approved local MCP server in E2B by cloning/updating repo, installing dependencies, and optionally starting it.",
      inputSchema: z.object({
        codingSessionId: z.string().min(1),
        serverId: z.string().min(1),
        workspaceRoot: z.string().default("/workspace/mcp"),
        installOnly: z.boolean().default(false),
      }),
      execute: async ({
        codingSessionId,
        serverId,
        workspaceRoot,
        installOnly,
      }) => {
        const server = localMcpServers.find((item) => item.id === serverId);
        if (!server) {
          throw new Error("Local MCP server is not approved for this run");
        }

        const config = (server.configJson ?? {}) as Record<string, unknown>;
        const repoUrl =
          typeof config.repoUrl === "string" ? config.repoUrl : null;
        const repoPath =
          typeof config.repoPath === "string"
            ? config.repoPath
            : `${workspaceRoot.replace(/\/$/, "")}/${server.id}`;
        const installCommand =
          typeof config.installCommand === "string"
            ? config.installCommand
            : "if [ -f package.json ]; then (pnpm install --frozen-lockfile || pnpm install); fi";
        const startCommand =
          typeof config.startCommand === "string" ? config.startCommand : null;

        const commands: string[] = [];
        if (repoUrl) {
          commands.push(
            `mkdir -p ${shellEscape(workspaceRoot)} && if [ -d ${shellEscape(repoPath)}/.git ]; then git -C ${shellEscape(repoPath)} pull --ff-only; else git clone ${shellEscape(repoUrl)} ${shellEscape(repoPath)}; fi`,
          );
        } else {
          commands.push(`mkdir -p ${shellEscape(repoPath)}`);
        }

        const cloneResult = await runSessionCommand({
          userId: params.userId,
          codingSessionId,
          command: commands[0],
          timeoutMs: 240_000,
        });

        const installResult = await runSessionCommand({
          userId: params.userId,
          codingSessionId,
          command: installCommand,
          cwd: repoPath,
          timeoutMs: 600_000,
        });

        let startResult: ExecCommandResult | null = null;
        if (!installOnly && startCommand) {
          const logSuffix = server.id.replace(/[^a-zA-Z0-9_-]/g, "_");
          const logPath = `/tmp/mcp-${logSuffix}.log`;
          startResult = await runSessionCommand({
            userId: params.userId,
            codingSessionId,
            command: `nohup ${startCommand} > ${shellEscape(logPath)} 2>&1 & echo $!`,
            cwd: repoPath,
            timeoutMs: 20_000,
          });
        }

        return {
          serverId: server.id,
          repoPath,
          cloneResult,
          installResult,
          startResult,
        };
      },
    });
  }

  const credentials = await getActiveProviderCredentials(params.userId);
  const availableExecutors = new Set<string>();
  if (
    credentials.some((credential) => credential.provider === ProviderId.OPENAI)
  ) {
    availableExecutors.add("codex");
  }
  if (
    credentials.some(
      (credential) => credential.provider === ProviderId.ANTHROPIC,
    )
  ) {
    availableExecutors.add("claude");
  }

  tools.e2b_container_connect = createTrackedTool({
    runId: params.runId,
    name: "e2b_container_connect",
    description: "Connect to or create a coding session sandbox.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      timeoutMs: z.number().int().min(60_000).max(3_600_000).default(1_800_000),
    }),
    execute: async ({ codingSessionId, timeoutMs }) => {
      return ensureSandboxForSession({
        userId: params.userId,
        codingSessionId,
        timeoutMs,
      });
    },
  });

  tools.e2b_container_exec = createTrackedTool({
    runId: params.runId,
    name: "e2b_container_exec",
    description: "Run a shell command in a connected coding sandbox.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().min(1000).max(900_000).default(120_000),
    }),
    execute: async ({ codingSessionId, command, cwd, timeoutMs }) => {
      assertCommandAllowed(command);
      await ensureToolApprovedOrRequest(params.runId, {
        kind: "tool.e2b.exec",
        title: "Approve shell execution",
        reason: "Arbitrary shell execution requested",
        payload: {
          command,
          cwd: cwd ?? null,
        },
      });

      return runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command,
        cwd,
        timeoutMs,
      });
    },
  });

  tools.repo_clone = createTrackedTool({
    runId: params.runId,
    name: "repo_clone",
    description:
      "Clone or refresh a GitHub repository into the sandbox workspace.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      repoFullName: z.string().optional(),
      destination: z.string().default("/workspace/repo"),
      branch: z.string().optional(),
    }),
    execute: async ({ codingSessionId, repoFullName, destination, branch }) => {
      const session = await ensureCodingSession(params.userId, codingSessionId);
      const repo = repoFullName ?? session.repoFullName;
      const githubToken = await getGithubTokenForUser(params.userId);
      const cloneUrl = `https://github.com/${repo}.git`;

      await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: "mkdir -p /workspace",
        timeoutMs: 30_000,
      });

      const existsResult = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: `if [ -d ${shellEscape(destination)}/.git ]; then echo exists; else echo missing; fi`,
        timeoutMs: 30_000,
      });

      const exists = existsResult.stdout.trim() === "exists";

      const result = exists
        ? await runSessionCommand({
            userId: params.userId,
            codingSessionId,
            command: `git -C ${shellEscape(destination)} fetch --all --prune`,
            timeoutMs: 180_000,
          })
        : await runSessionGitClone({
            userId: params.userId,
            codingSessionId,
            url: cloneUrl,
            destination,
            branch,
            depth: 1,
            username: githubToken ? "x-access-token" : undefined,
            password: githubToken ?? undefined,
            timeoutMs: 300_000,
          });

      return {
        ...result,
        repoFullName: repo,
        destination,
      };
    },
  });

  tools.repo_checkout = createTrackedTool({
    runId: params.runId,
    name: "repo_checkout",
    description: "Checkout an existing branch or create a new branch.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      branch: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
      create: z.boolean().default(false),
    }),
    execute: async ({ codingSessionId, branch, cwd, create }) => {
      const command = create
        ? `git checkout -b ${shellEscape(branch)}`
        : `git checkout ${shellEscape(branch)}`;
      return runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command,
        cwd,
        timeoutMs: 90_000,
      });
    },
  });

  tools.repo_search = createTrackedTool({
    runId: params.runId,
    name: "repo_search",
    description: "Search code within the repository using ripgrep.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      query: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
    }),
    execute: async ({ codingSessionId, query, cwd }) => {
      const result = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: `rg --line-number --hidden --color never ${shellEscape(query)} .`,
        cwd,
        timeoutMs: 90_000,
      });

      return {
        ...result,
        matchFound: result.exitCode === 0,
      };
    },
  });

  tools.repo_read_file = createTrackedTool({
    runId: params.runId,
    name: "repo_read_file",
    description: "Read lines from a file in the sandbox repository.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      path: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
      startLine: z.number().int().min(1).default(1),
      endLine: z.number().int().min(1).max(5000).default(240),
    }),
    execute: async ({ codingSessionId, path, cwd, startLine, endLine }) => {
      if (endLine < startLine) {
        throw new Error("endLine must be greater than or equal to startLine");
      }

      return runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: `sed -n '${startLine},${endLine}p' ${shellEscape(path)}`,
        cwd,
        timeoutMs: 30_000,
      });
    },
  });

  tools.repo_apply_patch = createTrackedTool({
    runId: params.runId,
    name: "repo_apply_patch",
    description: "Apply a unified diff patch with git apply --3way.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      patch: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
    }),
    execute: async ({ codingSessionId, patch, cwd }) => {
      const patchPath = `/tmp/patch-${Date.now()}.diff`;
      const patchBase64 = Buffer.from(patch, "utf8").toString("base64");

      const apply = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        cwd,
        timeoutMs: 120_000,
        command: `echo ${shellEscape(patchBase64)} | base64 --decode > ${shellEscape(patchPath)} && git apply --3way --whitespace=nowarn ${shellEscape(patchPath)}`,
      });

      const status = await readGitStatus(params.userId, codingSessionId, cwd);

      return {
        apply,
        status,
      };
    },
  });

  tools.repo_run_tests = createTrackedTool({
    runId: params.runId,
    name: "repo_run_tests",
    description: "Run lint/tests/typecheck command in the repo.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      command: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
      timeoutMs: z.number().int().min(1000).max(1_800_000).default(600_000),
    }),
    execute: async ({ codingSessionId, command, cwd, timeoutMs }) => {
      assertCommandAllowed(command);
      return runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command,
        cwd,
        timeoutMs,
      });
    },
  });

  tools.repo_status_diff = createTrackedTool({
    runId: params.runId,
    name: "repo_status_diff",
    description: "Get git status and diff summary from the repository.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
      maxDiffChars: z.number().int().min(1000).max(120_000).default(20_000),
    }),
    execute: async ({ codingSessionId, cwd, maxDiffChars }) => {
      const status = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: "git status --short",
        cwd,
        timeoutMs: 60_000,
      });

      const diff = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: "git diff --patch --minimal",
        cwd,
        timeoutMs: 120_000,
      });

      const stat = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: "git diff --stat",
        cwd,
        timeoutMs: 60_000,
      });

      return {
        status,
        stat,
        diff: {
          ...diff,
          stdout: truncate(diff.stdout, maxDiffChars),
        },
      };
    },
  });

  tools.repo_commit = createTrackedTool({
    runId: params.runId,
    name: "repo_commit",
    description: "Commit all staged/unstaged changes in the repo.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      message: z.string().min(1),
      cwd: z.string().default("/workspace/repo"),
    }),
    execute: async ({ codingSessionId, message, cwd }) => {
      return runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: `git add -A && git commit -m ${shellEscape(message)}`,
        cwd,
        timeoutMs: 90_000,
      });
    },
  });

  tools.repo_push_branch = createTrackedTool({
    runId: params.runId,
    name: "repo_push_branch",
    description: "Push a branch to remote origin.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      branch: z.string().min(1),
      remote: z.string().default("origin"),
      cwd: z.string().default("/workspace/repo"),
    }),
    execute: async ({ codingSessionId, branch, remote, cwd }) => {
      await ensureToolApprovedOrRequest(params.runId, {
        kind: "tool.repo.push",
        title: "Approve branch push",
        reason: "Pushing code to remote repository requires explicit approval",
        payload: {
          branch,
          remote,
          cwd,
        },
      });

      const githubToken = await getGithubTokenForUser(params.userId);
      if (githubToken) {
        return runSessionGitPush({
          userId: params.userId,
          codingSessionId,
          cwd,
          remote,
          branch,
          username: "x-access-token",
          password: githubToken,
          timeoutMs: 180_000,
        });
      }

      return runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command: `git push -u ${shellEscape(remote)} ${shellEscape(branch)}`,
        cwd,
        timeoutMs: 180_000,
      });
    },
  });

  tools.repo_create_draft_pr = createTrackedTool({
    runId: params.runId,
    name: "repo_create_draft_pr",
    description: "Create a draft GitHub PR from head branch to base branch.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      title: z.string().min(1),
      body: z.string().default(""),
      baseBranch: z.string().min(1),
      headBranch: z.string().min(1),
      repoFullName: z.string().optional(),
    }),
    execute: async ({
      codingSessionId,
      title,
      body,
      baseBranch,
      headBranch,
      repoFullName,
    }) => {
      const session = await ensureCodingSession(params.userId, codingSessionId);
      const repo = repoFullName ?? session.repoFullName;
      const installationId = await resolveGithubInstallationId(params.userId);

      if (!installationId) {
        throw new Error(
          "No GitHub installation found for user. Connect GitHub app first.",
        );
      }

      const token = await createInstallationToken(installationId);
      const { owner, repo: repoName } = normalizeRepoFullName(repo);
      const octokit = new Octokit({ auth: token });

      const pr = await octokit.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo: repoName,
        title,
        body,
        base: baseBranch,
        head: headBranch,
        draft: true,
      });

      await prisma.codingSession.update({
        where: { id: codingSessionId },
        data: {
          prUrl: pr.data.html_url,
          status: "pr_created",
        },
      });

      return {
        pullRequestNumber: pr.data.number,
        url: pr.data.html_url,
        state: pr.data.state,
        draft: pr.data.draft,
      };
    },
  });

  tools.delegate_codegen = createTrackedTool({
    runId: params.runId,
    name: "delegate_codegen",
    description:
      "Run delegated coding executor (claude/codex) in sandbox for full-task implementation before returning.",
    inputSchema: z.object({
      codingSessionId: z.string().min(1),
      executor: z.enum(["claude", "codex"]),
      prompt: z.string().min(1),
      workingDir: z.string().default("/workspace/repo"),
      maxMinutes: z.number().int().min(1).max(120).default(20),
    }),
    execute: async ({
      codingSessionId,
      executor,
      prompt,
      workingDir,
      maxMinutes,
    }) => {
      if (!availableExecutors.has(executor)) {
        throw new Error(
          `Executor ${executor} unavailable for configured provider keys`,
        );
      }

      await ensureToolApprovedOrRequest(params.runId, {
        kind: `tool.delegate.${executor}`,
        title: `Approve delegated ${executor} execution`,
        reason: `Delegated executor ${executor} can perform multi-step repository changes`,
        payload: {
          executor,
          workingDir,
          maxMinutes,
        },
      });

      const command =
        executor === "claude"
          ? `claude -p --permission-mode bypassPermissions --verbose ${shellEscape(prompt)}`
          : `codex exec ${shellEscape(prompt)}`;

      const output = await runSessionCommand({
        userId: params.userId,
        codingSessionId,
        command,
        cwd: workingDir,
        timeoutMs: maxMinutes * 60_000,
      });

      const statusResult = await readGitStatus(
        params.userId,
        codingSessionId,
        workingDir,
      );
      const combinedOutput = `${output.stdout}\n${output.stderr}`.toLowerCase();
      const status = combinedOutput.includes("needs_followup")
        ? "needs_followup"
        : output.exitCode === 0
          ? "completed"
          : "failed";

      return {
        status,
        summary:
          output.exitCode === 0
            ? `${executor} finished with exit code 0`
            : `${executor} exited with code ${output.exitCode}`,
        commandsRun: [command],
        changedFiles: statusResult.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        raw: output,
      };
    },
  });

  return tools;
}

class ModelInferenceError extends Error {
  readonly provider: ProviderId;
  readonly modelId: string;

  constructor(selection: SelectedModel, message: string) {
    super(message);
    this.name = "ModelInferenceError";
    this.provider = selection.provider;
    this.modelId = selection.modelId;
  }
}

export interface ExecuteRunInput {
  run: AgentRun;
  userId: string;
  userMessage: string;
  preferredProvider?: ProviderId;
  preferredModelId?: string;
}

async function runModelInference(params: {
  run: AgentRun;
  userId: string;
  userMessage: string;
  preferredProvider?: ProviderId;
  preferredModelId?: string;
}): Promise<{
  result: Awaited<ReturnType<typeof generateText>>;
  selectedModel: SelectedModel;
}> {
  const selectedModel = await selectModelForUser({
    userId: params.userId,
    preferredProvider: params.preferredProvider,
    preferredModelId: params.preferredModelId,
    requireTools: params.run.mode !== RunMode.CHAT,
  });

  const model = resolveLanguageModel(selectedModel);
  const coreTools = await buildCoreTools({
    userId: params.userId,
    runId: params.run.id,
    mode: params.run.mode,
    approvedMcp: params.run.approvedMcp,
  });
  const customTools = await buildCustomToolsForUser({
    userId: params.userId,
    executionTarget: modeToExecutionTarget(params.run.mode),
    runId: params.run.id,
  });
  const tools: ToolSet = {
    ...coreTools,
    ...customTools,
  };

  try {
    const result = await generateText({
      model,
      prompt: params.userMessage,
      system: buildSystemPrompt(params.run.mode),
      ...(params.run.mode === RunMode.CHAT
        ? {}
        : {
            tools,
            maxSteps: params.run.mode === RunMode.CODING ? 30 : 10,
          }),
    });

    return {
      result,
      selectedModel,
    };
  } catch (error) {
    throw new ModelInferenceError(
      selectedModel,
      error instanceof Error ? error.message : "Model inference failed",
    );
  }
}

async function resolveFallbackProvider(
  userId: string,
  currentProvider: ProviderId,
): Promise<ProviderId | null> {
  const credentials = await getActiveProviderCredentials(userId);
  const providers = [...new Set(credentials.map((item) => item.provider))];

  for (const provider of providers) {
    if (provider !== currentProvider) {
      return provider;
    }
  }

  return null;
}

export async function executeAgentRun(input: ExecuteRunInput) {
  await ensureRunNotCancelled(input.run.id);

  const executionTarget = modeToExecutionTarget(input.run.mode);

  await prisma.agentRun.update({
    where: { id: input.run.id },
    data: {
      status: RunStatus.RUNNING,
      executionTarget,
    },
  });

  await appendRunEvent(input.run.id, "run.started", {
    mode: input.run.mode,
    executionTarget,
  });

  try {
    const inference = await runModelInference({
      run: input.run,
      userId: input.userId,
      userMessage: input.userMessage,
      preferredProvider: input.preferredProvider,
      preferredModelId: input.preferredModelId,
    });

    const fallbackUsed = false;

    if (inference.result.text === "" && input.run.mode !== RunMode.CHAT) {
      await appendRunEvent(input.run.id, "run.warning", {
        message: "Model returned empty text response",
      });
    }

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: input.run.conversationId,
        role: "assistant",
        contentJson: {
          text: inference.result.text,
        },
        modelId: `${inference.selectedModel.provider}:${inference.selectedModel.modelId}`,
      },
    });

    await prisma.agentRun.update({
      where: { id: input.run.id },
      data: {
        status: RunStatus.COMPLETED,
        finalMessageJson: {
          text: inference.result.text,
          messageId: assistantMessage.id,
        },
        usageJson: {
          inputTokens: inference.result.usage?.inputTokens ?? null,
          outputTokens: inference.result.usage?.outputTokens ?? null,
          totalTokens: inference.result.usage?.totalTokens ?? null,
          steps: inference.result.steps.length,
          stepSummaries: inference.result.steps.map(mapStepSummary),
          provider: inference.selectedModel.provider,
          modelId: inference.selectedModel.modelId,
          fallbackUsed,
        } as Prisma.InputJsonValue,
        endedAt: new Date(),
      },
    });

    await appendRunEvent(input.run.id, "run.completed", {
      model: {
        provider: inference.selectedModel.provider,
        modelId: inference.selectedModel.modelId,
      },
      text: inference.result.text,
      steps: inference.result.steps.length,
      fallbackUsed,
    });

    return {
      text: inference.result.text,
      messageId: assistantMessage.id,
      usage: inference.result.usage,
      steps: inference.result.steps.length,
      model: inference.selectedModel,
      fallbackUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.startsWith("Approval required")) {
      await appendRunEvent(input.run.id, "run.awaiting_approval", {
        reason: message,
      });
      throw error;
    }

    if (error instanceof ModelInferenceError && !input.preferredProvider) {
      const fallbackProvider = await resolveFallbackProvider(
        input.userId,
        error.provider,
      );
      if (fallbackProvider) {
        await appendRunEvent(input.run.id, "run.model_fallback", {
          fromProvider: error.provider,
          fromModelId: error.modelId,
          toProvider: fallbackProvider,
          reason: error.message,
        });

        try {
          const fallbackInference = await runModelInference({
            run: input.run,
            userId: input.userId,
            userMessage: input.userMessage,
            preferredProvider: fallbackProvider,
            preferredModelId: undefined,
          });

          const assistantMessage = await prisma.message.create({
            data: {
              conversationId: input.run.conversationId,
              role: "assistant",
              contentJson: {
                text: fallbackInference.result.text,
              },
              modelId: `${fallbackInference.selectedModel.provider}:${fallbackInference.selectedModel.modelId}`,
            },
          });

          await prisma.agentRun.update({
            where: { id: input.run.id },
            data: {
              status: RunStatus.COMPLETED,
              finalMessageJson: {
                text: fallbackInference.result.text,
                messageId: assistantMessage.id,
              },
              usageJson: {
                inputTokens:
                  fallbackInference.result.usage?.inputTokens ?? null,
                outputTokens:
                  fallbackInference.result.usage?.outputTokens ?? null,
                totalTokens:
                  fallbackInference.result.usage?.totalTokens ?? null,
                steps: fallbackInference.result.steps.length,
                stepSummaries:
                  fallbackInference.result.steps.map(mapStepSummary),
                provider: fallbackInference.selectedModel.provider,
                modelId: fallbackInference.selectedModel.modelId,
                fallbackUsed: true,
              } as Prisma.InputJsonValue,
              endedAt: new Date(),
            },
          });

          await appendRunEvent(input.run.id, "run.completed", {
            model: {
              provider: fallbackInference.selectedModel.provider,
              modelId: fallbackInference.selectedModel.modelId,
            },
            text: fallbackInference.result.text,
            steps: fallbackInference.result.steps.length,
            fallbackUsed: true,
          });

          return {
            text: fallbackInference.result.text,
            messageId: assistantMessage.id,
            usage: fallbackInference.result.usage,
            steps: fallbackInference.result.steps.length,
            model: fallbackInference.selectedModel,
            fallbackUsed: true,
          };
        } catch (fallbackError) {
          await appendRunEvent(input.run.id, "run.fallback_failed", {
            error:
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError),
          });
        }
      }
    }

    await prisma.agentRun.update({
      where: { id: input.run.id },
      data: {
        status: RunStatus.FAILED,
        endedAt: new Date(),
        finalMessageJson: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      },
    });

    await appendRunEvent(input.run.id, "run.failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
