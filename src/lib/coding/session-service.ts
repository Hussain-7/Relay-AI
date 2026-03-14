import { Sandbox } from "@e2b/code-interpreter";
import { CodingSessionStatus } from "@prisma/client";

import { appendRunEvent } from "@/lib/run-events";
import { env, hasE2bConfig, hasGitHubAppConfig } from "@/lib/env";
import { getGitHubToken } from "@/lib/github/service";
import { prisma } from "@/lib/prisma";

const DEFAULT_WORKSPACE_ROOT = "/workspace";
const SANDBOX_TIMEOUT_MS = 1000 * 60 * 60; // 60 minutes
const TASK_TIMEOUT_MS = 1000 * 60 * 30; // 30 minutes

const log = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[coding-session] ${msg}`, data ? JSON.stringify(data) : ""),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[coding-session] ${msg}`, data ? JSON.stringify(data) : ""),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`[coding-session] ${msg}`, data ? JSON.stringify(data) : ""),
};

function getSandboxTemplate() {
  return env.E2B_TEMPLATE || "claude";
}

/**
 * Safe wrapper around sandbox.commands.run that NEVER throws.
 * E2B SDK throws CommandExitError on non-zero exit codes.
 * This wrapper catches those and returns a result object instead.
 */
async function safeRun(
  sandbox: Sandbox,
  command: string,
  opts?: { timeoutMs?: number; user?: "root"; envs?: Record<string, string>; onStdout?: (data: string) => void },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await sandbox.commands.run(command, opts);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (error) {
    // CommandExitError — extract what we can
    const err = error as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? String(error),
      exitCode: err.exitCode ?? 1,
    };
  }
}

async function connectSandboxOrThrow(sandboxId: string) {
  if (!hasE2bConfig()) {
    throw new Error("E2B_API_KEY is required for coding sessions.");
  }

  log.info("Connecting to sandbox", { sandboxId });
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: env.E2B_API_KEY,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });
  log.info("Connected to sandbox", { sandboxId });
  return sandbox;
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
  log.info("startOrResumeCodingSession", {
    conversationId: input.conversationId,
    userId: input.userId,
    repoBindingId: input.repoBindingId ?? undefined,
  });

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
    log.info("Resuming existing session", {
      sessionId: codingSession.id,
      sandboxId: codingSession.sandboxId,
      status: codingSession.status,
    });

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

  // Look up repo binding — support both UUID and repoFullName for resilience
  let repoBinding = input.repoBindingId
    ? await prisma.repoBinding.findUnique({ where: { id: input.repoBindingId } })
    : null;

  // Fallback: if the ID didn't match (e.g. agent passed a full name), try by full name
  if (!repoBinding && input.repoBindingId?.includes("/")) {
    repoBinding = await prisma.repoBinding.findFirst({
      where: { userId: input.userId, repoFullName: input.repoBindingId },
    });
    if (repoBinding) {
      log.info("Resolved repoBinding by fullName fallback", { repoFullName: input.repoBindingId, bindingId: repoBinding.id });
    }
  }

  const template = getSandboxTemplate();
  const workspaceSlug = repoBinding?.repoName ?? input.conversationId;
  const workspacePath = `${DEFAULT_WORKSPACE_ROOT}/${workspaceSlug}`;

  log.info("Creating new sandbox", {
    template,
    workspacePath,
    repoFullName: repoBinding?.repoFullName ?? null,
  });

  const sandbox = await Sandbox.create(template, {
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

  log.info("Sandbox created", { sandboxId: sandbox.sandboxId, template });

  // Ensure /workspace exists and is writable
  await safeRun(sandbox, `mkdir -p "${DEFAULT_WORKSPACE_ROOT}" && chmod 777 "${DEFAULT_WORKSPACE_ROOT}"`, { user: "root" });

  // Only create workspace dir + CLAUDE.md when there's no repo binding.
  // When a repo is bound, ensureRepoCloned handles directory creation via git clone.
  if (!repoBinding) {
    await sandbox.files.makeDir(workspacePath);
    await sandbox.files.write(`${workspacePath}/CLAUDE.md`, SANDBOX_CLAUDE_MD);
  }

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

  log.info("Session created", {
    sessionId: codingSession.id,
    sandboxId: sandbox.sandboxId,
    workspacePath,
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

  if (!session.repoBinding || !session.workspacePath) {
    log.info("No repo binding — skipping clone");
    return sandbox;
  }

  const repoFullName = session.repoBinding.repoFullName;
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  log.info("Checking if repo already cloned", { repoFullName, workspacePath: session.workspacePath });

  const cloneCheck = await safeRun(sandbox,
    `test -d "${session.workspacePath}/.git" && echo "exists" || echo "missing"`,
  );

  if (cloneCheck.stdout.trim() === "exists") {
    log.info("Repo already cloned — refreshing remote URL", { repoFullName });
    // Mark as safe directory (cloned as root, CLI runs as user)
    await safeRun(sandbox, `git config --global --add safe.directory '${session.workspacePath}'`);
    await safeRun(sandbox, `cd "${session.workspacePath}" && git remote set-url origin '${cloneUrl}'`);
    return sandbox;
  }

  // Clean up any leftover directory from a failed previous clone attempt
  const dirCheck = await safeRun(sandbox,
    `test -d "${session.workspacePath}" && echo "exists" || echo "missing"`,
  );
  if (dirCheck.stdout.trim() === "exists") {
    log.info("Removing leftover workspace directory before clone", { workspacePath: session.workspacePath });
    await safeRun(sandbox, `rm -rf "${session.workspacePath}"`, { user: "root" });
  }

  log.info("Cloning repo (shallow)", { repoFullName, workspacePath: session.workspacePath });

  // Run as root to avoid permission issues in the sandbox
  const cloneResult = await safeRun(sandbox,
    `git clone --depth 1 '${cloneUrl}' '${session.workspacePath}' 2>&1; echo "===EXIT:$?"`,
    { timeoutMs: 120000, user: "root" },
  );

  // Parse exit code from output
  const exitMatch = cloneResult.stdout.match(/===EXIT:(\d+)/);
  const cloneExitCode = exitMatch ? parseInt(exitMatch[1], 10) : cloneResult.exitCode;
  const cloneOutput = cloneResult.stdout.replace(/===EXIT:\d+/, "").trim();

  log.info("Git clone result", { cloneExitCode, output: cloneOutput.slice(-300) });

  if (cloneExitCode !== 0) {
    throw new Error(`Git clone failed (exit ${cloneExitCode}): ${cloneOutput.slice(-300)}`);
  }

  log.info("Clone successful — configuring git and permissions");

  // Mark as safe directory (cloned as root, CLI runs as non-root user)
  await safeRun(sandbox, `git config --global --add safe.directory '${session.workspacePath}'`);

  await safeRun(sandbox,
    `cd "${session.workspacePath}" && git config user.email "relay-ai@users.noreply.github.com" && git config user.name "Relay AI"`,
    { user: "root" },
  );

  // Make workspace writable by the sandbox user (for Claude Code CLI)
  await safeRun(sandbox, `chmod -R 777 "${session.workspacePath}"`, { user: "root" });

  // Write CLAUDE.md after clone so the coding agent has project context
  await sandbox.files.write(`${session.workspacePath}/CLAUDE.md`, SANDBOX_CLAUDE_MD);

  log.info("Repo ready", { repoFullName, workspacePath: session.workspacePath });

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
  log.info("runCodingTask starting", {
    codingSessionId: input.codingSessionId,
    taskBrief: input.taskBrief.slice(0, 100),
  });

  const session = await prisma.codingSession.findUnique({
    where: { id: input.codingSessionId },
    include: { repoBinding: true },
  });

  if (!session?.sandboxId) {
    throw new Error("Coding session has no sandbox.");
  }

  try {
    // Get a fresh GitHub token for clone/push (if repo is bound)
    let gitToken: string | null = null;
    if (session.repoBinding && hasGitHubAppConfig()) {
      log.info("Fetching GitHub token for repo", {
        repoFullName: session.repoBinding.repoFullName,
      });
      gitToken = await getGitHubToken(input.userId);
      if (!gitToken) {
        throw new Error("GitHub token unavailable. Ensure the GitHub App is installed.");
      }
      log.info("GitHub token obtained");
    }

    log.info("About to ensure repo cloned");

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

    log.info("Repo clone done, updating session to RUNNING");

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
    const escapedTask = input.taskBrief.replace(/'/g, "'\\''");
    // Resume the previous Claude Code session if one exists (maintains conversation context)
    const sessionFlag = session.claudeSdkSessionId
      ? ` --resume ${session.claudeSdkSessionId}`
      : "";

    // Verify claude CLI is available
    const claudeCheck = await safeRun(sandbox, "which claude && claude --version 2>&1 || echo 'claude not found'");
    log.info("Claude CLI check", { stdout: claudeCheck.stdout.trim(), exitCode: claudeCheck.exitCode });

    const modelFlag = ` --model ${env.ANTHROPIC_CODING_MODEL}`;
    // Wrap in sh -c so the outer command always exits 0 (avoids E2B CommandExitError).
    // The real exit code is captured via ===CLI_EXIT:$?===.
    // stderr is merged into stdout so we capture error messages from the CLI.
    const innerCmd = `cd "${session.workspacePath}" && claude --dangerously-skip-permissions --output-format stream-json --verbose${modelFlag} -p '${escapedTask}'${sessionFlag}`;
    const cmd = `sh -c '${innerCmd.replace(/'/g, "'\\''")} 2>&1; echo "===CLI_EXIT:$?==="'`;
    log.info("Running Claude Code CLI", {
      workspacePath: session.workspacePath,
      model: env.ANTHROPIC_CODING_MODEL,
      hasSessionId: Boolean(session.claudeSdkSessionId),
      timeoutMs: TASK_TIMEOUT_MS,
    });

    // Collect streaming events
    const events: Array<Record<string, unknown>> = [];
    let finalResult = "";
    let sessionId: string | null = null;
    let lineBuf = "";
    let cliExitCode = -1;
    let stderrCapture = "";

    const cliEnvs: Record<string, string> = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
    };
    if (gitToken) {
      cliEnvs.GITHUB_TOKEN = gitToken;
    }

    await safeRun(sandbox, cmd, {
      envs: cliEnvs,
      timeoutMs: TASK_TIMEOUT_MS,
      onStdout: (data) => {
        // Buffer partial lines for correct JSONL parsing
        lineBuf += data;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;

          // Capture the exit code sentinel
          const exitMatch = line.match(/===CLI_EXIT:(\d+)===/);
          if (exitMatch) {
            cliExitCode = parseInt(exitMatch[1], 10);
            continue;
          }

          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            events.push(event);

            // Capture session ID and final result
            if (event.type === "system" && event.subtype === "init") {
              sessionId = (event.session_id as string) ?? null;
              log.info("Claude Code session initialized", { sessionId });
            }
            if (event.type === "result") {
              finalResult =
                typeof event.result === "string"
                  ? event.result
                  : JSON.stringify(event.result);
              sessionId = (event.session_id as string) ?? sessionId;
              log.info("Claude Code result received", {
                resultLength: finalResult.length,
                sessionId,
              });
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
            // Non-JSON line — capture as potential error output
            stderrCapture += line + "\n";
          }
        }
      },
    });

    // Check remaining buffer for exit sentinel
    if (lineBuf.trim()) {
      const exitMatch = lineBuf.match(/===CLI_EXIT:(\d+)===/);
      if (exitMatch) {
        cliExitCode = parseInt(exitMatch[1], 10);
      } else {
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
          stderrCapture += lineBuf;
        }
      }
    }

    log.info("Claude Code CLI finished", {
      cliExitCode,
      eventCount: events.length,
      hasResult: Boolean(finalResult),
      stderrPreview: stderrCapture.slice(0, 500),
    });

    // Update session to READY with session ID for resumption
    await prisma.codingSession.update({
      where: { id: session.id },
      data: {
        status: CodingSessionStatus.READY,
        claudeSdkSessionId: sessionId,
        lastActiveAt: new Date(),
      },
    });

    log.info("Coding task completed", {
      sessionId,
      cliExitCode,
      resultPreview: finalResult.slice(0, 100),
      eventCount: events.length,
    });

    return {
      result:
        finalResult ||
        stderrCapture.slice(0, 2000) ||
        "Agent completed with no output.",
      sessionId,
      exitCode: cliExitCode,
      sandboxId: session.sandboxId,
      workspacePath: session.workspacePath,
      repoFullName: session.repoBinding?.repoFullName ?? null,
      branch: session.branch,
      eventCount: events.length,
    };
  } catch (error) {
    log.error("Coding task failed", {
      error: error instanceof Error ? error.message : String(error),
      codingSessionId: session.id,
    });

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
  log.info("Pausing session", { codingSessionId: input.codingSessionId });

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

  log.info("Session paused", { codingSessionId: updatedSession.id });

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
