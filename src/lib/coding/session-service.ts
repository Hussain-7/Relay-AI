import { Sandbox } from "@e2b/code-interpreter";
import { CodingSessionStatus } from "@/generated/prisma/client";
import { env, hasE2bConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { buildDotEnvContent, getDecryptedSecrets } from "@/lib/repo-secrets";
import { appendRunEvent } from "@/lib/run-events";

/**
 * Format a compact summary of a tool call's input for display in the timeline.
 * e.g. `Bash(pnpm typecheck)`, `Read(/src/lib/foo.ts)`, `Grep(pattern)`.
 */
function formatToolInputSummary(toolName: string, toolInput: unknown): string {
  const inp = (typeof toolInput === "object" && toolInput !== null ? toolInput : {}) as Record<string, unknown>;

  switch (toolName) {
    case "Bash": {
      const cmd = typeof inp.command === "string" ? inp.command : "";
      const preview = cmd.length > 150 ? cmd.slice(0, 150) + "…" : cmd;
      return preview ? `Bash(${preview})` : "Bash";
    }
    case "Read": {
      const filePath = typeof inp.file_path === "string" ? inp.file_path : "";
      return filePath ? `Read(${filePath})` : "Read";
    }
    case "Edit": {
      const filePath = typeof inp.file_path === "string" ? inp.file_path : "";
      return filePath ? `Edit(${filePath})` : "Edit";
    }
    case "Write": {
      const filePath = typeof inp.file_path === "string" ? inp.file_path : "";
      return filePath ? `Write(${filePath})` : "Write";
    }
    case "Glob": {
      const pattern = typeof inp.pattern === "string" ? inp.pattern : "";
      return pattern ? `Glob(${pattern})` : "Glob";
    }
    case "Grep": {
      const pattern = typeof inp.pattern === "string" ? inp.pattern : "";
      return pattern ? `Grep(${pattern})` : "Grep";
    }
    case "Agent":
    case "Task": {
      const desc = typeof inp.description === "string" ? inp.description : "";
      const prompt = typeof inp.prompt === "string" ? inp.prompt : "";
      const subType = typeof inp.subagent_type === "string" ? inp.subagent_type : "";
      // Prefer description (short summary), fall back to truncated prompt
      const label = desc || (prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt);
      const prefix = subType ? `${subType}: ` : "";
      return label ? `Task(${prefix}${label})` : "Task";
    }
    default:
      return toolName;
  }
}

/**
 * Extract text content from a tool_result content block.
 * Handles both string content and array-of-text-blocks formats.
 */
function extractToolResultContent(block: Record<string, unknown>): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c: unknown): c is { type: string; text: string } =>
          typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
      )
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

/**
 * Truncate tool result content with per-tool limits to keep events manageable.
 */
function truncateToolResult(toolName: string, content: string): string {
  const limits: Record<string, number> = {
    Bash: 3000,
    Read: 1500,
    Write: 2000,
    Edit: 2000,
    Grep: 2000,
    Glob: 2000,
  };
  const limit = limits[toolName] ?? 1500;
  return content.length <= limit ? content : content.slice(0, limit) + "\n…truncated";
}

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

export async function connectSandboxOrThrow(sandboxId: string) {
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

/**
 * Kill the E2B sandbox and mark the coding session as CLOSED.
 * Saves cost by not letting idle sandboxes run for the full timeout.
 */
export async function closeCodingSession(conversationId: string) {
  const session = await prisma.codingSession.findFirst({
    where: {
      conversationId,
      status: { in: ["PROVISIONING", "READY", "RUNNING", "PAUSED", "ERROR"] },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!session) {
    return { closed: false, reason: "No active coding session found." };
  }

  if (session.sandboxId && hasE2bConfig()) {
    try {
      const sandbox = await Sandbox.connect(session.sandboxId, {
        apiKey: env.E2B_API_KEY,
        timeoutMs: 10_000,
      });
      await sandbox.kill();
      log.info("Sandbox killed", { sandboxId: session.sandboxId, sessionId: session.id });
    } catch (err) {
      // Sandbox may already be dead — that's fine
      log.warn("Failed to kill sandbox (may already be stopped)", {
        sandboxId: session.sandboxId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await prisma.codingSession.update({
    where: { id: session.id },
    data: { status: CodingSessionStatus.CLOSED },
  });

  return {
    closed: true,
    sessionId: session.id,
    sandboxId: session.sandboxId,
  };
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
          CodingSessionStatus.ERROR,
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

    try {
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

      return { session: codingSession, sandbox };
    } catch (err) {
      log.warn("Sandbox reconnect failed — marking session CLOSED, will create fresh sandbox", {
        sessionId: codingSession.id,
        sandboxId: codingSession.sandboxId,
        error: err instanceof Error ? err.message : String(err),
      });
      await prisma.codingSession.update({
        where: { id: codingSession.id },
        data: { status: CodingSessionStatus.CLOSED },
      });
      codingSession = null;
      // Fall through to create a new sandbox
    }
  } else if (codingSession) {
    // Session exists but has no sandboxId (stuck in PROVISIONING or ERROR) — clean up
    log.warn("Found session with no sandboxId — marking CLOSED", {
      sessionId: codingSession.id,
      status: codingSession.status,
    });
    await prisma.codingSession.update({
      where: { id: codingSession.id },
      data: { status: CodingSessionStatus.CLOSED },
    });
    codingSession = null;
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
      log.info("Resolved repoBinding by fullName fallback", {
        repoFullName: input.repoBindingId,
        bindingId: repoBinding.id,
      });
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

  try {
    // Ensure /workspace exists and is writable
    await safeRun(sandbox, `mkdir -p "${DEFAULT_WORKSPACE_ROOT}" && chmod 777 "${DEFAULT_WORKSPACE_ROOT}"`, {
      user: "root",
    });

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

    // Note: coding.session.created and coding.session.ready events are emitted
    // via ctx.emitProgress in the calling tool (coding-session.ts), which handles
    // both SSE delivery and DB persistence. No appendRunEvent needed here.

    return { session: codingSession, sandbox };
  } catch (err) {
    // Kill the sandbox to prevent orphaned E2B instances incurring compute costs
    log.warn("Sandbox setup failed — killing orphaned sandbox", {
      sandboxId: sandbox.sandboxId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await sandbox.kill();
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

/**
 * Clone the repo into the sandbox and set up git credentials.
 * If already cloned, refreshes the remote URL with the provided token.
 * Accepts a pre-connected Sandbox instance to avoid redundant connections.
 */
export async function ensureRepoCloned(
  sandbox: Sandbox,
  session: {
    workspacePath: string | null;
    repoBinding: { id?: string; repoFullName: string } | null;
  },
  token: string,
  gitUser: { name: string; email: string },
) {
  if (!session.repoBinding || !session.workspacePath) {
    log.info("No repo binding — skipping clone");
    return sandbox;
  }

  const repoFullName = session.repoBinding.repoFullName;
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  log.info("Checking if repo already cloned", { repoFullName, workspacePath: session.workspacePath });

  const cloneCheck = await safeRun(
    sandbox,
    `test -d "${session.workspacePath}/.git" && echo "exists" || echo "missing"`,
  );

  if (cloneCheck.stdout.trim() === "exists") {
    log.info("Repo already cloned — refreshing remote URL", { repoFullName });
    // Mark as safe directory (cloned as root, CLI runs as user)
    await safeRun(sandbox, `git config --global --add safe.directory '${session.workspacePath}'`);
    await safeRun(sandbox, `cd "${session.workspacePath}" && git remote set-url origin '${cloneUrl}'`);

    // Write .env with repo secrets (refresh on every reconnect)
    await writeRepoSecretsEnv(sandbox, session.workspacePath, session.repoBinding.id);

    return sandbox;
  }

  // Clean up any leftover directory from a failed previous clone attempt
  const dirCheck = await safeRun(sandbox, `test -d "${session.workspacePath}" && echo "exists" || echo "missing"`);
  if (dirCheck.stdout.trim() === "exists") {
    log.info("Removing leftover workspace directory before clone", { workspacePath: session.workspacePath });
    await safeRun(sandbox, `rm -rf "${session.workspacePath}"`, { user: "root" });
  }

  log.info("Cloning repo", { repoFullName, workspacePath: session.workspacePath });

  // Full clone (not shallow) so the agent can create branches, view history, etc.
  const cloneResult = await safeRun(
    sandbox,
    `git clone '${cloneUrl}' '${session.workspacePath}' 2>&1; echo "===EXIT:$?"`,
    { timeoutMs: 180000, user: "root" },
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

  await safeRun(
    sandbox,
    `cd "${session.workspacePath}" && git config user.email '${gitUser.email}' && git config user.name '${gitUser.name}'`,
    { user: "root" },
  );

  // Configure git credential helper so all remotes authenticate with the token
  const escapedToken = token.replace(/'/g, "'\\''");
  await safeRun(
    sandbox,
    `git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${escapedToken}"; }; f'`,
    { user: "root" },
  );

  // Ensure gh CLI is available (no-op if already installed in the E2B template)
  await safeRun(
    sandbox,
    `which gh > /dev/null 2>&1 || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && apt-get update -qq && apt-get install -y -qq gh > /dev/null 2>&1)`,
    { user: "root", timeoutMs: 60000 },
  );

  // Make workspace writable by the sandbox user (for Claude Code CLI)
  await safeRun(sandbox, `chmod -R 777 "${session.workspacePath}"`, { user: "root" });

  // Write CLAUDE.md after clone so the coding agent has project context
  await sandbox.files.write(`${session.workspacePath}/CLAUDE.md`, SANDBOX_CLAUDE_MD);

  // Write .env with repo secrets
  await writeRepoSecretsEnv(sandbox, session.workspacePath, session.repoBinding.id);

  log.info("Repo ready", { repoFullName, workspacePath: session.workspacePath });

  return sandbox;
}

/**
 * Write decrypted repo secrets as a `.env` file in the workspace.
 * Also ensures `.env` is listed in `.gitignore` to prevent accidental commits.
 */
async function writeRepoSecretsEnv(sandbox: Sandbox, workspacePath: string, repoBindingId: string | undefined) {
  if (!repoBindingId) return;

  try {
    const secrets = await getDecryptedSecrets(repoBindingId);
    if (secrets.length === 0) return;

    const dotEnvContent = buildDotEnvContent(secrets);
    await sandbox.files.write(`${workspacePath}/.env`, dotEnvContent);

    // Ensure .env is in .gitignore
    const check = await safeRun(
      sandbox,
      `grep -qxF '.env' "${workspacePath}/.gitignore" 2>/dev/null && echo exists || echo missing`,
    );
    if (check.stdout.trim() === "missing") {
      await safeRun(sandbox, `printf '\\n.env\\n' >> "${workspacePath}/.gitignore"`);
    }

    log.info("Wrote .env with repo secrets", { repoBindingId, count: secrets.length });
  } catch (err) {
    log.warn("Failed to write repo secrets .env", {
      repoBindingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run the Claude Code CLI inside the E2B sandbox and stream results back.
 * Uses `claude --dangerously-skip-permissions --output-format stream-json`.
 *
 * Requires a pre-connected sandbox. Sandbox provisioning, repo cloning, and
 * token fetching are handled by prepare_sandbox and clone_repo_sandbox tools.
 */
export async function runCodingTask(input: {
  codingSessionId: string;
  conversationId: string;
  runId: string;
  userId: string;
  taskBrief: string;
  onProgress?: (
    type: import("@/lib/contracts").TimelineEventType,
    source: import("@/lib/contracts").TimelineSource,
    payload?: Record<string, unknown> | null,
  ) => void;
  /** Pre-connected sandbox (required). */
  sandbox: Sandbox;
  /** GitHub token for git push (optional — only needed if repo is bound). */
  gitToken?: string | null;
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
    const sandbox = input.sandbox;
    const gitToken = input.gitToken ?? null;

    log.info("Updating session to RUNNING");

    // Update session to RUNNING
    await prisma.codingSession.update({
      where: { id: session.id },
      data: { status: CodingSessionStatus.RUNNING, lastActiveAt: new Date() },
    });

    // Emit coding.agent.running via onProgress (handles SSE + DB persistence)
    input.onProgress?.("coding.agent.running", "coding_agent", {
      codingSessionId: session.id,
      workspacePath: session.workspacePath,
      message: "Running coding agent...",
    });
    const escapedTask = input.taskBrief.replace(/'/g, "'\\''");
    // Resume the previous Claude Code session if one exists (maintains conversation context)
    const sessionFlag = session.claudeSdkSessionId ? ` --resume ${session.claudeSdkSessionId}` : "";

    // Refresh .env before each task (picks up secrets saved after the sandbox started)
    await writeRepoSecretsEnv(sandbox, session.workspacePath ?? DEFAULT_WORKSPACE_ROOT, session.repoBinding?.id);

    // Verify claude CLI is available
    const claudeCheck = await safeRun(sandbox, "which claude && claude --version 2>&1 || echo 'claude not found'");
    log.info("Claude CLI check", { stdout: claudeCheck.stdout.trim(), exitCode: claudeCheck.exitCode });

    const modelFlag = ` --model ${env.ANTHROPIC_CODING_MODEL}`;
    // Wrap in sh -c so the outer command always exits 0 (avoids E2B CommandExitError).
    // The real exit code is captured via ===CLI_EXIT:$?===.
    // stderr is merged into stdout so we capture error messages from the CLI.
    const innerCmd = `cd "${session.workspacePath}" && claude --dangerously-skip-permissions --bare --output-format stream-json --verbose${modelFlag} -p '${escapedTask}'${sessionFlag}`;
    const cmd = `sh -c '${innerCmd.replace(/'/g, "'\\''")} 2>&1; echo "===CLI_EXIT:$?==="'`;
    log.info("Running Claude Code CLI", {
      workspacePath: session.workspacePath,
      model: env.ANTHROPIC_CODING_MODEL,
      hasSessionId: Boolean(session.claudeSdkSessionId),
      timeoutMs: TASK_TIMEOUT_MS,
    });

    // Collect streaming events
    const events: Array<Record<string, unknown>> = [];
    const pendingToolUses = new Map<string, string>(); // toolUseId → toolName
    let finalResult = "";
    let sessionId: string | null = null;
    let lineBuf = "";
    let cliExitCode = -1;
    let stderrCapture = "";
    let codingCostUsd: number | null = null;
    let codingUsage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    } | null = null;
    let codingDurationMs: number | null = null;

    const cliEnvs: Record<string, string> = {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
    };
    if (gitToken) {
      cliEnvs.GITHUB_TOKEN = gitToken;
      cliEnvs.GH_TOKEN = gitToken; // gh CLI prefers GH_TOKEN in some versions
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
            if (env.DEBUG_AGENT_EVENTS) {
              console.log("[coding-agent-event]", JSON.stringify(event).slice(0, 500));
            }
            events.push(event);

            // Capture session ID and final result
            if (event.type === "system" && event.subtype === "init") {
              sessionId = (event.session_id as string) ?? null;
              log.info("Claude Code session initialized", { sessionId });
            }

            // Subagent events (task lifecycle)
            if (event.type === "system") {
              const subtype = event.subtype as string | undefined;
              if (subtype === "task_started") {
                input.onProgress?.("coding.agent.task.started", "coding_agent", {
                  taskId: (event.task_id as string) ?? null,
                  description: typeof event.description === "string" ? event.description : "task",
                  subagentType: (event.subagent_type as string) ?? null,
                });
              }
              if (subtype === "task_progress") {
                input.onProgress?.("coding.agent.task.progress", "coding_agent", {
                  taskId: (event.task_id as string) ?? null,
                  description: typeof event.description === "string" ? event.description : "",
                  lastToolName: (event.last_tool_name as string) ?? null,
                  usage: event.usage ?? null,
                });
              }
              if (subtype === "task_notification") {
                input.onProgress?.("coding.agent.task.completed", "coding_agent", {
                  taskId: (event.task_id as string) ?? null,
                  description: typeof event.description === "string" ? event.description : "task",
                  status: (event.status as string) ?? "completed",
                  usage: event.usage ?? null,
                });
              }
            }

            if (event.type === "result") {
              finalResult = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
              sessionId = (event.session_id as string) ?? sessionId;

              // Capture usage/cost data from the result event
              if (typeof event.total_cost_usd === "number") {
                codingCostUsd = event.total_cost_usd;
              } else if (typeof event.total_cost === "number") {
                codingCostUsd = event.total_cost;
              }
              const usageData = event.usage as Record<string, unknown> | undefined;
              if (usageData) {
                codingUsage = {
                  inputTokens: Number(usageData.input_tokens ?? 0),
                  outputTokens: Number(usageData.output_tokens ?? 0),
                  cacheReadTokens: Number(usageData.cache_read_input_tokens ?? 0),
                  cacheWriteTokens: Number(usageData.cache_creation_input_tokens ?? 0),
                };
              }
              if (typeof event.duration_ms === "number") {
                codingDurationMs = event.duration_ms;
              } else if (typeof event.num_turns === "number") {
                codingDurationMs = null; // duration not always present
              }

              // Emit usage event so UI can display cost in real-time
              if (codingCostUsd != null) {
                input.onProgress?.("coding.agent.usage", "coding_agent", {
                  costUsd: codingCostUsd,
                  usage: codingUsage,
                  durationMs: codingDurationMs,
                });
              }

              log.info("Claude Code result received", {
                resultLength: finalResult.length,
                sessionId,
                costUsd: codingCostUsd,
              });
            }

            // Emit coding agent sub-tool events to SSE stream (real-time) and DB
            if (event.type === "assistant" && event.message) {
              const msg = event.message as { content?: Array<Record<string, unknown>> };
              if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  // Thinking blocks
                  if (block.type === "thinking" && typeof block.thinking === "string") {
                    const text = (block.thinking as string).slice(0, 2000);
                    if (text.trim()) {
                      input.onProgress?.("coding.agent.thinking", "coding_agent", { text });
                    }
                  }

                  // Text blocks
                  if (block.type === "text" && typeof block.text === "string") {
                    const text = (block.text as string).slice(0, 2000);
                    if (text.trim()) {
                      input.onProgress?.("coding.agent.text", "coding_agent", { text });
                    }
                  }

                  if (block.type === "tool_use") {
                    // Capture tool input — truncate to keep events manageable
                    const toolInput = block.input;
                    const inputPreview =
                      typeof toolInput === "string"
                        ? toolInput.slice(0, 1000)
                        : JSON.stringify(toolInput ?? {}).slice(0, 1000);
                    const inputSummary = formatToolInputSummary(block.name as string, toolInput);
                    const payload = {
                      toolName: block.name as string,
                      toolUseId: block.id as string,
                      toolRuntime: "coding_agent",
                      input: toolInput,
                      inputSummary,
                    };
                    input.onProgress?.("tool.call.started", "coding_agent", { ...payload, input: inputPreview });
                    pendingToolUses.set(block.id as string, block.name as string);
                  }
                }
              }
            }

            // Tool results arrive in user messages — complete pending tool uses
            if (event.type === "user" && event.message) {
              const msg = event.message as { content?: Array<Record<string, unknown>> };
              if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === "tool_result") {
                    const toolUseId = block.tool_use_id as string;
                    const toolName = pendingToolUses.get(toolUseId) ?? "tool";
                    const rawContent = extractToolResultContent(block);
                    const resultContent = rawContent ? truncateToolResult(toolName, rawContent) : null;
                    input.onProgress?.("tool.call.completed", "coding_agent", {
                      toolUseId,
                      toolName,
                      toolRuntime: "coding_agent",
                      resultContent,
                      isError: block.is_error === true,
                    });
                    pendingToolUses.delete(toolUseId);
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
            finalResult = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
            sessionId = (event.session_id as string) ?? sessionId;
          }
        } catch {
          stderrCapture += lineBuf;
        }
      }
    }

    // Close any unclosed tool entries (prevents perpetual "Running" state)
    for (const [toolUseId, toolName] of pendingToolUses) {
      const payload = { toolUseId, toolName, toolRuntime: "coding_agent" };
      input.onProgress?.("tool.call.completed", "coding_agent", payload);
    }
    pendingToolUses.clear();

    // Capture git diff after task completes for visibility into code changes
    if (session.workspacePath) {
      try {
        // Try uncommitted changes first, fall back to last commit's changes
        const diffResult = await safeRun(
          sandbox,
          `cd "${session.workspacePath}" && git diff HEAD --stat 2>/dev/null && echo "===DIFF===" && git diff HEAD 2>/dev/null`,
          { timeoutMs: 10000 },
        );
        let diffStat = "";
        let fullDiff = "";
        const parts = diffResult.stdout.split("===DIFF===");
        diffStat = (parts[0] ?? "").trim();
        fullDiff = (parts[1] ?? "").trim();

        // If no uncommitted changes, check what was committed
        if (!fullDiff) {
          const commitDiff = await safeRun(
            sandbox,
            `cd "${session.workspacePath}" && git diff HEAD~1..HEAD --stat 2>/dev/null && echo "===DIFF===" && git diff HEAD~1..HEAD 2>/dev/null`,
            { timeoutMs: 10000 },
          );
          const cParts = commitDiff.stdout.split("===DIFF===");
          diffStat = (cParts[0] ?? "").trim();
          fullDiff = (cParts[1] ?? "").trim();
        }

        if (fullDiff) {
          const truncated = fullDiff.length > 8000 ? fullDiff.slice(0, 8000) + "\n…diff truncated" : fullDiff;
          input.onProgress?.("coding.agent.diff", "coding_agent", {
            diffStat,
            diff: truncated,
          });
        }
      } catch {
        /* non-fatal */
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
      result: finalResult || stderrCapture.slice(0, 2000) || "Agent completed with no output.",
      sessionId,
      exitCode: cliExitCode,
      sandboxId: session.sandboxId,
      workspacePath: session.workspacePath,
      repoFullName: session.repoBinding?.repoFullName ?? null,
      branch: session.branch,
      eventCount: events.length,
      costUsd: codingCostUsd,
      usage: codingUsage,
      durationMs: codingDurationMs,
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
