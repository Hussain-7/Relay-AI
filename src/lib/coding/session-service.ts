import { Sandbox } from "@e2b/code-interpreter";
import { CodingSessionStatus } from "@prisma/client";

import { appendRunEvent } from "@/lib/run-events";
import { env, hasE2bConfig, hasGitHubAppConfig } from "@/lib/env";
import { getGitHubToken } from "@/lib/github/service";
import { prisma } from "@/lib/prisma";

const DEFAULT_WORKSPACE_ROOT = "/workspace";
const SANDBOX_TIMEOUT_MS = 1000 * 60 * 60; // 60 minutes
const TASK_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes

function getSandboxTemplate() {
  return env.E2B_TEMPLATE || "claude";
}

async function connectSandboxOrThrow(sandboxId: string) {
  if (!hasE2bConfig()) {
    throw new Error("E2B_API_KEY is required for coding sessions.");
  }

  return Sandbox.connect(sandboxId, {
    apiKey: env.E2B_API_KEY,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });
}

export async function getLatestCodingSession(conversationId: string) {
  return prisma.codingSession.findFirst({
    where: { conversationId },
    orderBy: { updatedAt: "desc" },
    include: {
      repoBinding: true,
    },
  });
}

const SANDBOX_CLAUDE_MD = `
You are Relay AI's coding agent working in a sandboxed workspace.

- Inspect the repository and project context before editing.
- Make small, focused edits and use explicit execution summaries.
- Use git to commit changes with clear messages.
- If the task includes pushing, run git push.
- Output a brief summary of what you did when finished.
- Summarize changed files, commands run, and open risks.
`.trim();

export async function startOrResumeCodingSession(input: {
  conversationId: string;
  userId: string;
  runId?: string;
  repoBindingId?: string | null;
  taskBrief?: string;
  branchStrategy?: string;
}) {
  let codingSession = await prisma.codingSession.findFirst({
    where: {
      conversationId: input.conversationId,
      status: {
        in: [
          CodingSessionStatus.PROVISIONING,
          CodingSessionStatus.READY,
          CodingSessionStatus.RUNNING,
          CodingSessionStatus.PAUSED,
        ],
      },
    },
    orderBy: { updatedAt: "desc" },
    include: { repoBinding: true },
  });

  if (codingSession?.sandboxId) {
    const sandbox = await connectSandboxOrThrow(codingSession.sandboxId);
    await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);

    codingSession = await prisma.codingSession.update({
      where: { id: codingSession.id },
      data: {
        status: CodingSessionStatus.READY,
        lastActiveAt: new Date(),
      },
      include: { repoBinding: true },
    });

    if (input.runId) {
      await appendRunEvent({
        runId: input.runId,
        conversationId: input.conversationId,
        type: "coding.session.resumed",
        source: "system",
        payload: {
          codingSessionId: codingSession.id,
          sandboxId: codingSession.sandboxId,
          workspacePath: codingSession.workspacePath,
        },
      });
    }

    return codingSession;
  }

  if (!hasE2bConfig()) {
    throw new Error("E2B_API_KEY is required for coding sessions.");
  }

  const repoBinding =
    input.repoBindingId == null
      ? null
      : await prisma.repoBinding.findUnique({
          where: { id: input.repoBindingId },
        });

  const workspaceSlug = repoBinding?.repoName ?? input.conversationId;
  const workspacePath = `${DEFAULT_WORKSPACE_ROOT}/${workspaceSlug}`;
  const sandbox = await Sandbox.create(getSandboxTemplate(), {
    apiKey: env.E2B_API_KEY,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    metadata: {
      conversationId: input.conversationId,
      userId: input.userId,
    },
    envs: {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
    },
    allowInternetAccess: true,
  });

  await sandbox.files.makeDir(workspacePath);

  // Write CLAUDE.md for the coding agent (Claude Code reads this automatically)
  await sandbox.files.write(`${workspacePath}/CLAUDE.md`, SANDBOX_CLAUDE_MD);

  codingSession = await prisma.codingSession.create({
    data: {
      conversationId: input.conversationId,
      userId: input.userId,
      repoBindingId: input.repoBindingId ?? null,
      sandboxId: sandbox.sandboxId,
      workspacePath,
      branch: input.branchStrategy ?? `chat/${input.conversationId}`,
      status: CodingSessionStatus.READY,
      lastActiveAt: new Date(),
      claudeSdkSessionId: null,
    },
    include: { repoBinding: true },
  });

  if (input.runId) {
    await appendRunEvent({
      runId: input.runId,
      conversationId: input.conversationId,
      type: "coding.session.created",
      source: "system",
      payload: {
        codingSessionId: codingSession.id,
        sandboxId: codingSession.sandboxId,
        workspacePath: codingSession.workspacePath,
        taskBrief: input.taskBrief ?? null,
      },
    });

    await appendRunEvent({
      runId: input.runId,
      conversationId: input.conversationId,
      type: "coding.session.ready",
      source: "system",
      payload: {
        codingSessionId: codingSession.id,
        sandboxId: codingSession.sandboxId,
        workspacePath: codingSession.workspacePath,
        branch: codingSession.branch,
      },
    });
  }

  return codingSession;
}

/**
 * Clone the repo into the sandbox and set up git credentials.
 * If already cloned, refreshes the remote URL with the provided token.
 * Returns the sandbox instance for further commands.
 */
async function ensureRepoCloned(
  session: {
    sandboxId: string;
    workspacePath: string | null;
    repoBinding: { repoFullName: string } | null;
  },
  token: string,
) {
  const sandbox = await connectSandboxOrThrow(session.sandboxId);

  if (!session.repoBinding || !session.workspacePath) return sandbox;

  const repoFullName = session.repoBinding.repoFullName;
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  const cloneCheck = await sandbox.commands.run(
    `test -d "${session.workspacePath}/.git" && echo "exists" || echo "missing"`,
  );

  if (cloneCheck.stdout.trim() === "exists") {
    // Already cloned — refresh remote URL with fresh token for push access
    await sandbox.commands.run(
      `cd "${session.workspacePath}" && git remote set-url origin ${cloneUrl}`,
    );
    return sandbox;
  }

  // Shallow clone for speed
  await sandbox.commands.run(
    `git clone --depth 1 ${cloneUrl} "${session.workspacePath}"`,
    { timeoutMs: 60000 },
  );

  await sandbox.commands.run(
    `cd "${session.workspacePath}" && git config user.email "relay-ai@users.noreply.github.com" && git config user.name "Relay AI"`,
  );

  return sandbox;
}

/**
 * Run the Claude Code CLI inside the E2B sandbox and stream results back.
 * Uses `claude --dangerously-skip-permissions --output-format stream-json`.
 */
export async function runCodingTask(input: {
  codingSessionId: string;
  conversationId: string;
  runId: string;
  userId: string;
  taskBrief: string;
}) {
  const session = await prisma.codingSession.findUnique({
    where: { id: input.codingSessionId },
    include: { repoBinding: true },
  });

  if (!session?.sandboxId) {
    throw new Error("Coding session has no sandbox.");
  }

  // Get a fresh GitHub token for clone/push (if repo is bound)
  let gitToken: string | null = null;
  if (session.repoBinding && hasGitHubAppConfig()) {
    gitToken = await getGitHubToken(input.userId);
    if (!gitToken) {
      throw new Error("GitHub token unavailable. Ensure the GitHub App is installed.");
    }
  }

  // Clone repo into sandbox (or refresh remote URL with fresh token)
  const sandbox = gitToken
    ? await ensureRepoCloned(
        {
          sandboxId: session.sandboxId,
          workspacePath: session.workspacePath,
          repoBinding: session.repoBinding,
        },
        gitToken,
      )
    : await connectSandboxOrThrow(session.sandboxId);

  // Update session to RUNNING
  await prisma.codingSession.update({
    where: { id: session.id },
    data: { status: CodingSessionStatus.RUNNING, lastActiveAt: new Date() },
  });

  await appendRunEvent({
    runId: input.runId,
    conversationId: input.conversationId,
    type: "coding.agent.running",
    source: "coding_agent",
    payload: { codingSessionId: session.id, workspacePath: session.workspacePath },
  });

  try {
    const escapedTask = input.taskBrief.replace(/'/g, "'\\''");
    const sessionFlag = session.claudeSdkSessionId
      ? ` --session-id ${session.claudeSdkSessionId}`
      : "";

    // Collect streaming events
    const events: Array<Record<string, unknown>> = [];
    let finalResult = "";
    let sessionId: string | null = null;
    let lineBuf = "";

    const cliEnvs: Record<string, string> = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
    };
    if (gitToken) {
      cliEnvs.GITHUB_TOKEN = gitToken;
    }

    const result = await sandbox.commands.run(
      `cd "${session.workspacePath}" && claude --dangerously-skip-permissions --output-format stream-json -p '${escapedTask}'${sessionFlag}`,
      {
        envs: cliEnvs,
        timeoutMs: TASK_TIMEOUT_MS,
        onStdout: (data) => {
          // Buffer partial lines for correct JSONL parsing
          lineBuf += data;
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              events.push(event);

              // Capture session ID and final result
              if (event.type === "system" && event.subtype === "init") {
                sessionId = (event.session_id as string) ?? null;
              }
              if (event.type === "result") {
                finalResult =
                  typeof event.result === "string"
                    ? event.result
                    : JSON.stringify(event.result);
                sessionId = (event.session_id as string) ?? sessionId;
              }

              // Emit tool events to timeline in real-time
              if (event.type === "assistant" && event.message) {
                const msg = event.message as { content?: Array<Record<string, unknown>> };
                if (Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block.type === "tool_use") {
                      appendRunEvent({
                        runId: input.runId,
                        conversationId: input.conversationId,
                        type: "tool.call.started",
                        source: "coding_agent",
                        payload: {
                          toolName: block.name as string,
                          toolUseId: block.id as string,
                        },
                      });
                    }
                    if (block.type === "tool_result") {
                      appendRunEvent({
                        runId: input.runId,
                        conversationId: input.conversationId,
                        type: "tool.call.completed",
                        source: "coding_agent",
                        payload: {
                          toolUseId: block.tool_use_id as string,
                        },
                      });
                    }
                    if (block.type === "text") {
                      appendRunEvent({
                        runId: input.runId,
                        conversationId: input.conversationId,
                        type: "assistant.text.delta",
                        source: "coding_agent",
                        payload: { delta: block.text as string },
                      });
                    }
                  }
                }
              }
            } catch {
              /* non-JSON line — skip */
            }
          }
        },
      },
    );

    // Process any remaining buffered content
    if (lineBuf.trim()) {
      try {
        const event = JSON.parse(lineBuf) as Record<string, unknown>;
        events.push(event);
        if (event.type === "result") {
          finalResult =
            typeof event.result === "string"
              ? event.result
              : JSON.stringify(event.result);
          sessionId = (event.session_id as string) ?? sessionId;
        }
      } catch {
        /* non-JSON trailing content */
      }
    }

    // Update session to READY with session ID for resumption
    await prisma.codingSession.update({
      where: { id: session.id },
      data: {
        status: CodingSessionStatus.READY,
        claudeSdkSessionId: sessionId,
        lastActiveAt: new Date(),
      },
    });

    return {
      result:
        finalResult ||
        (result.exitCode !== 0 ? result.stderr.slice(0, 2000) : "") ||
        "Agent completed with no output.",
      sessionId,
      exitCode: result.exitCode,
      sandboxId: session.sandboxId,
      workspacePath: session.workspacePath,
      repoFullName: session.repoBinding?.repoFullName ?? null,
      branch: session.branch,
      eventCount: events.length,
    };
  } catch (error) {
    // Error recovery — reset session status so it doesn't stay stuck in RUNNING
    await prisma.codingSession.update({
      where: { id: session.id },
      data: {
        status: CodingSessionStatus.ERROR,
        lastActiveAt: new Date(),
      },
    });

    await appendRunEvent({
      runId: input.runId,
      conversationId: input.conversationId,
      type: "tool.call.failed",
      source: "coding_agent",
      payload: {
        error: error instanceof Error ? error.message : "Coding task failed",
        codingSessionId: session.id,
      },
    });

    throw error;
  }
}

export async function pauseCodingSession(input: {
  codingSessionId: string;
  conversationId: string;
  runId?: string;
}) {
  const codingSession = await prisma.codingSession.findUnique({
    where: { id: input.codingSessionId },
  });

  if (!codingSession?.sandboxId) {
    throw new Error("Coding session is missing a sandbox.");
  }

  const sandbox = await connectSandboxOrThrow(codingSession.sandboxId);
  await sandbox.betaPause();

  const updatedSession = await prisma.codingSession.update({
    where: { id: input.codingSessionId },
    data: {
      status: CodingSessionStatus.PAUSED,
      lastActiveAt: new Date(),
    },
  });

  if (input.runId) {
    await appendRunEvent({
      runId: input.runId,
      conversationId: input.conversationId,
      type: "coding.session.paused",
      source: "system",
      payload: {
        codingSessionId: updatedSession.id,
        sandboxId: updatedSession.sandboxId,
      },
    });
  }

  return updatedSession;
}
