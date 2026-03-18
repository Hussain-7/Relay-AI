import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Sandbox } from "@e2b/code-interpreter";

import {
  startOrResumeCodingSession,
  ensureRepoCloned,
  runCodingTask,
  closeCodingSession,
  connectSandboxOrThrow,
} from "@/lib/coding/session-service";
import { getGitHubToken } from "@/lib/github/service";
import { hasE2bConfig, hasGitHubAppConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

// ── Catalog entries for the UI tool list ──

export const codingSessionCatalog: ToolCatalogEntry[] = [
  {
    id: "prepare_sandbox",
    label: "Prepare sandbox",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Provision a cloud sandbox or reconnect to an existing one for remote coding.",
  },
  {
    id: "clone_repo_sandbox",
    label: "Clone repository",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Clone the linked GitHub repository into the sandbox. Skips if already cloned.",
  },
  {
    id: "coding_agent_sandbox",
    label: "Coding agent",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Run a coding task using Claude Code inside the sandbox. Reads, writes, edits files, runs commands, and manages git.",
  },
  {
    id: "bash_sandbox",
    label: "Run command",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Execute a shell command in the active sandbox — run tests, check git status, install packages.",
  },
  {
    id: "get_sandbox_url",
    label: "Get sandbox URL",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Get public URLs for apps running in the sandbox — temporary, live only while sandbox is active.",
  },
  {
    id: "bash",
    label: "Bash",
    runtime: "coding_agent",
    kind: "claude_code_builtin",
    enabled: true,
    description: "Shell access inside the remote coding workspace (used by the coding agent).",
  },
  {
    id: "text_editor",
    label: "Text editor",
    runtime: "coding_agent",
    kind: "claude_code_builtin",
    enabled: true,
    description: "File editing inside the remote coding workspace (used by the coding agent).",
  },
  {
    id: "close_sandbox",
    label: "Close sandbox",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Shut down the sandbox to stop billing. A new one is created automatically when needed.",
  },
];

// ── Shared sandbox cache (closure-level, shared across all tools in a run) ──

type CodingSessionWithRepo = Awaited<ReturnType<typeof startOrResumeCodingSession>>["session"];

interface RunSandboxCache {
  session: CodingSessionWithRepo | null;
  sandbox: Sandbox | null;
  gitToken: string | null;
  gitUser: { name: string; email: string } | null;
  repoReady: boolean;
}

/**
 * Lightweight sandbox health check — runs `echo ok` with a 5s timeout.
 * Returns false if the sandbox is dead/unreachable.
 */
async function isSandboxAlive(sandbox: Sandbox): Promise<boolean> {
  try {
    const result = await sandbox.commands.run("echo ok", { timeoutMs: 5000 });
    return result.exitCode === 0 && result.stdout.trim() === "ok";
  } catch {
    return false;
  }
}

// ── Combined factory: all coding tools share a single cache ──

export function createCodingTools(ctx: ToolRuntimeContext) {
  const cache: RunSandboxCache = {
    session: null,
    sandbox: null,
    gitToken: null,
    gitUser: null,
    repoReady: false,
  };

  /** Clear sandbox-related cache (keep token/user since they're independent). */
  function clearSandboxCache() {
    cache.session = null;
    cache.sandbox = null;
    cache.repoReady = false;
  }

  /** Resolve repoBindingId from the conversation's linked repo. */
  async function resolveRepoBindingId(): Promise<string | undefined> {
    const conv = await prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
    });
    return conv?.repoBindingId ?? undefined;
  }

  /** Fetch git user profile for commit identity. */
  async function fetchGitUser(): Promise<{ name: string; email: string }> {
    const userProfile = await prisma.userProfile.findUnique({
      where: { userId: ctx.userId },
      select: { email: true, fullName: true },
    });
    return {
      name: userProfile?.fullName ?? "Relay AI User",
      email: userProfile?.email ?? `${ctx.userId}@users.noreply.github.com`,
    };
  }

  // ── prepare_sandbox ──

  const prepareSandboxTool = betaZodTool({
    name: "prepare_sandbox",
    description:
      "Provision a new E2B cloud sandbox or reconnect to an existing one. Call this FIRST before any coding work. Creates a persistent environment where code can be written, compiled, tested, and committed. If a sandbox already exists for this conversation, reconnects and reuses it.",
    inputSchema: z.object({
      branchStrategy: z.string().optional().describe("Branch naming strategy (defaults to chat/{conversationId})"),
    }),
    async run(input) {
      try {
        const repoBindingId = await resolveRepoBindingId();

        const { session, sandbox } = await startOrResumeCodingSession({
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          runId: ctx.runId,
          repoBindingId,
          branchStrategy: input.branchStrategy,
        });

        cache.session = session;
        cache.sandbox = sandbox;
        cache.repoReady = false; // New sandbox — repo not cloned yet

        // Link coding session to agent run
        await prisma.agentRun.update({
          where: { id: ctx.runId },
          data: { codingSessionId: session.id },
        });

        const resultSummary = `Sandbox ready (${session.sandboxId}). Workspace: ${session.workspacePath}`;
        await ctx.emit("tool.call.completed", {
          toolName: "prepare_sandbox",
          toolRuntime: "custom",
          input,
          codingSessionId: session.id,
          sandboxId: session.sandboxId,
          workspacePath: session.workspacePath,
          status: "ready",
          result: resultSummary,
        });

        return jsonResult({
          sandboxId: session.sandboxId,
          workspacePath: session.workspacePath,
          status: "ready",
          hasRepo: Boolean(session.repoBinding),
          repoFullName: session.repoBinding?.repoFullName ?? null,
        });
      } catch (error) {
        clearSandboxCache();
        await ctx.emit("tool.call.failed", {
          toolName: "prepare_sandbox",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Failed to prepare sandbox",
        });
        throw error;
      }
    },
  });

  // ── clone_repo_sandbox ──

  const cloneRepoTool = betaZodTool({
    name: "clone_repo_sandbox",
    description:
      "Clone the linked GitHub repository into the sandbox. Intelligently checks if the repo is already cloned — if so, just refreshes the git remote with a fresh token. If not, performs a shallow clone and configures git credentials. Call after prepare_sandbox when a repo is linked.",
    inputSchema: z.object({}),
    async run(input) {
      try {
        if (!cache.session || !cache.sandbox) {
          throw new Error("No active sandbox. Call prepare_sandbox first.");
        }

        // Verify sandbox is alive
        if (!(await isSandboxAlive(cache.sandbox))) {
          clearSandboxCache();
          throw new Error("Sandbox is no longer reachable. Call prepare_sandbox to provision a new one.");
        }

        if (!cache.session.repoBinding) {
          return jsonResult({
            cloned: false,
            reason: "No repo linked to this conversation.",
            workspacePath: cache.session.workspacePath,
          });
        }

        // Fetch GitHub token if not cached
        if (!cache.gitToken && hasGitHubAppConfig()) {
          cache.gitToken = await getGitHubToken(ctx.userId);
          if (!cache.gitToken) {
            throw new Error("GitHub token unavailable. Ensure the GitHub App is installed.");
          }
        }
        if (!cache.gitToken) {
          throw new Error("GitHub token required but unavailable.");
        }

        // Fetch git user if not cached
        if (!cache.gitUser) {
          cache.gitUser = await fetchGitUser();
        }

        await ensureRepoCloned(
          cache.sandbox,
          {
            workspacePath: cache.session.workspacePath,
            repoBinding: cache.session.repoBinding,
          },
          cache.gitToken,
          cache.gitUser,
        );

        cache.repoReady = true;

        const repoFullName = cache.session.repoBinding.repoFullName;
        const repoUrl = `https://github.com/${repoFullName}`;
        const resultSummary = `Cloned ${repoFullName} into ${cache.session.workspacePath}`;

        await ctx.emit("tool.call.completed", {
          toolName: "clone_repo_sandbox",
          toolRuntime: "custom",
          // Backfill input with repo URL so it shows in the request section
          input: { repository: repoUrl },
          result: resultSummary,
          repoFullName,
          workspacePath: cache.session.workspacePath,
        });

        return jsonResult({
          cloned: true,
          repoFullName,
          workspacePath: cache.session.workspacePath,
        });
      } catch (error) {
        // Don't clear sandbox cache on repo errors — sandbox is still valid
        cache.repoReady = false;
        await ctx.emit("tool.call.failed", {
          toolName: "clone_repo_sandbox",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Failed to ensure repo",
        });
        throw error;
      }
    },
  });

  // ── coding_agent_sandbox ──

  const codingAgentTool = betaZodTool({
    name: "coding_agent_sandbox",
    description:
      "Run a coding task inside the sandbox using Claude Code. Reads, writes, and edits files, runs shell commands, manages git commits, and can push and create PRs. Requires prepare_sandbox (and clone_repo_sandbox if a repo is linked) to be called first. Can be called multiple times — each call reuses the same sandbox without re-provisioning.",
    inputSchema: z.object({
      taskBrief: z.string().min(1).describe("Clear description of the coding task to perform"),
    }),
    async run(input) {
      try {
        if (!cache.session || !cache.sandbox) {
          throw new Error("No active sandbox. Call prepare_sandbox (and clone_repo_sandbox if a repo is linked) before coding_agent_sandbox.");
        }

        // Verify cached sandbox is still alive
        if (!(await isSandboxAlive(cache.sandbox))) {
          clearSandboxCache();
          throw new Error("Sandbox is no longer reachable. Call prepare_sandbox to provision a new one, then clone_repo_sandbox, then retry coding_agent_sandbox.");
        }

        const session = cache.session;
        const sandbox = cache.sandbox;

        // Run the coding task — sandbox and token are pre-cached
        const taskResult = await runCodingTask({
          codingSessionId: session.id,
          conversationId: ctx.conversationId,
          runId: ctx.runId,
          userId: ctx.userId,
          taskBrief: input.taskBrief,
          onProgress: ctx.emitProgress,
          sandbox,
          gitToken: cache.gitToken,
        });

        // Persist coding agent cost to AgentRun metadata
        if (taskResult.costUsd != null) {
          await prisma.agentRun.update({
            where: { id: ctx.runId },
            data: {
              metadataJson: {
                codingAgent: {
                  costUsd: taskResult.costUsd,
                  usage: taskResult.usage,
                  durationMs: taskResult.durationMs,
                },
              },
            },
          });
        }

        await ctx.emit("tool.call.completed", {
          toolName: "coding_agent_sandbox",
          toolRuntime: "custom",
          input,
          codingSessionId: session.id,
          sandboxId: taskResult.sandboxId,
          workspacePath: taskResult.workspacePath,
          status: taskResult.exitCode === 0 ? "completed" : "failed",
          eventCount: taskResult.eventCount,
          result: taskResult.result.slice(0, 2000),
        });

        return jsonResult({
          codingSessionId: session.id,
          status: taskResult.exitCode === 0 ? "completed" : "failed",
          workspacePath: taskResult.workspacePath,
          branch: taskResult.branch,
          repoFullName: taskResult.repoFullName,
          result: taskResult.result,
          agentSessionId: taskResult.sessionId,
        });
      } catch (error) {
        // Only clear sandbox cache on sandbox-level errors, not task failures
        if (error instanceof Error && (error.message.includes("No active sandbox") || error.message.includes("no longer reachable"))) {
          clearSandboxCache();
        }
        await ctx.emit("tool.call.failed", {
          toolName: "coding_agent_sandbox",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Unknown coding agent error",
        });
        throw error;
      }
    },
  });

  // ── bash_sandbox ──

  const bashSandboxTool = betaZodTool({
    name: "bash_sandbox",
    description:
      "Run a shell command in the active sandbox. Use for quick operations: checking git status/log, running tests, listing files, installing packages, or verifying changes. Requires an active sandbox (call prepare_sandbox first). Do NOT confuse with code_execution — that is a temporary server-side sandbox with no repo access.",
    inputSchema: z.object({
      command: z.string().min(1).describe("The shell command to execute"),
      workspacePath: z.string().optional().describe("Working directory (defaults to the session workspace)"),
      timeoutMs: z.number().optional().describe("Timeout in ms (default 30s)"),
    }),
    async run(input) {
      try {
        if (!hasE2bConfig()) {
          throw new Error("E2B_API_KEY is required.");
        }

        // Try to use cached sandbox first
        let sandbox = cache.sandbox;
        let cwd = input.workspacePath ?? cache.session?.workspacePath ?? "/workspace";

        if (!sandbox) {
          // Fallback: look up session from DB and connect directly
          const session = await prisma.codingSession.findFirst({
            where: {
              conversationId: ctx.conversationId,
              status: { in: ["READY", "RUNNING"] },
            },
            orderBy: { updatedAt: "desc" },
          });

          if (!session?.sandboxId) {
            throw new Error("No active coding session. Start one first with prepare_sandbox or coding_agent_sandbox.");
          }

          sandbox = await connectSandboxOrThrow(session.sandboxId);
          cwd = input.workspacePath ?? session.workspacePath ?? "/workspace";
        }

        const result = await sandbox.commands.run(
          `cd "${cwd}" && ${input.command}`,
          { timeoutMs: input.timeoutMs ?? 30000 },
        );

        const output = {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 2000),
        };

        await ctx.emit("tool.call.completed", {
          toolName: "bash_sandbox",
          toolRuntime: "custom",
          input,
          exitCode: result.exitCode,
          result: (result.stdout || result.stderr).slice(0, 2000),
        });

        return jsonResult(output);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "bash_sandbox",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Unknown sandbox exec error",
        });
        throw error;
      }
    },
  });

  // ── get_sandbox_url ──

  const getSandboxUrlTool = betaZodTool({
    name: "get_sandbox_url",
    description:
      "Get temporary public URLs for apps running in the sandbox. Takes port numbers and returns publicly accessible URLs. The URLs are only available while the sandbox is running. ALWAYS start the app first (via coding_agent_sandbox or bash_sandbox) and verify it's running before calling this tool.",
    inputSchema: z.object({
      ports: z.array(z.number()).min(1).describe("Port numbers to get public URLs for"),
    }),
    async run(input) {
      try {
        if (!hasE2bConfig()) {
          throw new Error("E2B_API_KEY is required.");
        }

        // Try to use cached sandbox first
        let sandbox = cache.sandbox;

        if (!sandbox) {
          // Fallback: look up session from DB and connect directly
          const session = await prisma.codingSession.findFirst({
            where: {
              conversationId: ctx.conversationId,
              status: { in: ["READY", "RUNNING"] },
            },
            orderBy: { updatedAt: "desc" },
          });

          if (!session?.sandboxId) {
            throw new Error("No active coding session. Start one first with prepare_sandbox.");
          }

          sandbox = await connectSandboxOrThrow(session.sandboxId);
        }

        const urls = input.ports.map((port) => ({
          port,
          url: `https://${sandbox.getHost(port)}`,
        }));

        const result = {
          urls,
          note: "These URLs are temporary and only available while the sandbox is running.",
        };

        await ctx.emit("tool.call.completed", {
          toolName: "get_sandbox_url",
          toolRuntime: "custom",
          input,
          result: JSON.stringify(result),
        });

        return jsonResult(result);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "get_sandbox_url",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Failed to get sandbox URLs",
        });
        throw error;
      }
    },
  });

  // ── close_sandbox ──

  const closeSandboxTool = betaZodTool({
    name: "close_sandbox",
    description:
      "Shut down the active sandbox to stop billing. Use when coding work is complete and no more sandbox commands are needed. A new sandbox will be provisioned automatically if needed later.",
    inputSchema: z.object({
      confirm: z.boolean().describe("Set to true to confirm closing the sandbox"),
    }),
    async run(input) {
      try {
        if (!input.confirm) {
          return jsonResult({ closed: false, reason: "Confirmation required. Set confirm: true to close." });
        }

        const result = await closeCodingSession(ctx.conversationId);

        if (result.closed) {
          ctx.emitProgress("coding.session.paused", "system", {
            message: "Sandbox closed",
            codingSessionId: result.sessionId,
          });
        }

        // Clear entire cache — sandbox is dead
        cache.session = null;
        cache.sandbox = null;
        cache.gitToken = null;
        cache.gitUser = null;
        cache.repoReady = false;

        await ctx.emit("tool.call.completed", {
          toolName: "close_sandbox",
          toolRuntime: "custom",
          input,
          ...result,
        });

        return jsonResult(result);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "close_sandbox",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Failed to close sandbox",
        });
        throw error;
      }
    },
  });

  return {
    prepareSandboxTool,
    cloneRepoTool,
    codingAgentTool,
    bashSandboxTool,
    getSandboxUrlTool,
    closeSandboxTool,
  };
}
