#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

type Executor = "claude" | "codex";

interface RunnerCliArgs {
  runId: string;
  apiBaseUrl: string;
  eventToken: string;
  executor?: Executor;
  prompt?: string;
  workingDir: string;
  maxMinutes: number;
  repoFullName?: string;
  baseBranch?: string;
  workingBranch?: string;
}

interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

interface RunnerBootstrapOptions {
  runId: string;
  apiBaseUrl: string;
  eventToken: string;
  executor?: Executor;
  prompt?: string;
  workingDir?: string;
  maxMinutes?: number;
  repoFullName?: string;
  baseBranch?: string;
  workingBranch?: string;
}

const DEFAULT_TOOLSET = [
  "web.search",
  "e2b.container.connect",
  "e2b.container.exec",
];

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseCliArgs(argv: string[]): RunnerCliArgs {
  const flags: Record<string, string> = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.join("=");
  }

  const runId = flags.runId;
  const apiBaseUrl = flags.apiBaseUrl;
  const eventToken = flags.eventToken || process.env.RUNNER_EVENT_TOKEN || "";

  if (!runId) {
    throw new Error("Missing --runId");
  }

  if (!apiBaseUrl) {
    throw new Error("Missing --apiBaseUrl");
  }

  if (!eventToken) {
    throw new Error("Missing --eventToken or RUNNER_EVENT_TOKEN env");
  }

  const executor =
    flags.executor === "claude" || flags.executor === "codex"
      ? flags.executor
      : undefined;
  const maxMinutesRaw = Number(flags.maxMinutes ?? "30");
  const maxMinutes = Number.isFinite(maxMinutesRaw)
    ? Math.max(1, Math.min(240, Math.floor(maxMinutesRaw)))
    : 30;

  return {
    runId,
    apiBaseUrl,
    eventToken,
    executor,
    prompt: flags.prompt,
    workingDir: flags.workingDir || "/workspace/repo",
    maxMinutes,
    repoFullName: flags.repoFullName,
    baseBranch: flags.baseBranch,
    workingBranch: flags.workingBranch,
  };
}

function buildExecutorCommand(executor: Executor, prompt: string): string {
  if (executor === "claude") {
    return `claude -p --permission-mode bypassPermissions --verbose ${shellEscape(prompt)}`;
  }

  return `codex exec ${shellEscape(prompt)}`;
}

async function postRunEvent(
  args: RunnerCliArgs,
  type: string,
  payload: unknown,
): Promise<void> {
  const endpoint = `${args.apiBaseUrl.replace(/\/$/, "")}/api/internal/runs/${encodeURIComponent(args.runId)}/events`;

  await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runner-token": args.eventToken,
    },
    body: JSON.stringify({
      type,
      payload,
      ts: new Date().toISOString(),
    }),
  });
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        command,
        stdout,
        stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

async function ensureRepoPrepared(args: RunnerCliArgs): Promise<{
  repoFullName: string;
  baseBranch: string;
  workingBranch: string;
}> {
  if (!args.repoFullName) {
    throw new Error("Missing repoFullName for runner repository preparation");
  }

  const baseBranch = args.baseBranch || "main";
  const workingBranch = args.workingBranch || `agent/${args.runId}`;
  const githubToken = process.env.GITHUB_TOKEN;
  const cloneUrl = githubToken
    ? `https://x-access-token:${githubToken}@github.com/${args.repoFullName}.git`
    : `https://github.com/${args.repoFullName}.git`;

  await postRunEvent(args, "repo.prepare.started", {
    repoFullName: args.repoFullName,
    baseBranch,
    workingBranch,
    workingDir: args.workingDir,
  });

  const cloneResult = await runCommand(
    `mkdir -p /workspace && if [ -d ${shellEscape(args.workingDir)}/.git ]; then git -C ${shellEscape(args.workingDir)} fetch --all --prune; else git clone ${shellEscape(cloneUrl)} ${shellEscape(args.workingDir)}; fi`,
    "/",
    10 * 60_000,
  );

  await postRunEvent(args, "repo.cloned", {
    result: cloneResult,
    repoFullName: args.repoFullName,
    workingDir: args.workingDir,
  });

  if (cloneResult.exitCode !== 0) {
    throw new Error(
      `Repository clone/fetch failed with code ${cloneResult.exitCode}`,
    );
  }

  const checkoutBaseResult = await runCommand(
    `git fetch origin ${shellEscape(baseBranch)} && git checkout ${shellEscape(baseBranch)}`,
    args.workingDir,
    120_000,
  );

  const checkoutWorkingResult = await runCommand(
    `git checkout -B ${shellEscape(workingBranch)}`,
    args.workingDir,
    60_000,
  );

  await postRunEvent(args, "branch.created", {
    baseBranch,
    workingBranch,
    checkoutBaseResult,
    checkoutWorkingResult,
  });

  if (
    checkoutBaseResult.exitCode !== 0 ||
    checkoutWorkingResult.exitCode !== 0
  ) {
    throw new Error("Branch checkout failed");
  }

  return {
    repoFullName: args.repoFullName,
    baseBranch,
    workingBranch,
  };
}

function summarizeCommandResult(result: CommandResult): string {
  if (result.exitCode === 0) {
    return `Command succeeded in ${result.durationMs}ms`;
  }

  return `Command failed with exit code ${result.exitCode}`;
}

export function describeRunnerBootstrap(
  options: RunnerBootstrapOptions,
): string {
  return `Runner bootstrap for ${options.runId} with tools: ${DEFAULT_TOOLSET.join(", ")}`;
}

export async function runRunnerWithOptions(
  options: RunnerBootstrapOptions,
): Promise<void> {
  const args = parseCliArgs([
    `--runId=${options.runId}`,
    `--apiBaseUrl=${options.apiBaseUrl}`,
    `--eventToken=${options.eventToken}`,
    ...(options.executor ? [`--executor=${options.executor}`] : []),
    ...(options.prompt ? [`--prompt=${options.prompt}`] : []),
    `--workingDir=${options.workingDir ?? "/workspace/repo"}`,
    `--maxMinutes=${String(options.maxMinutes ?? 30)}`,
    ...(options.repoFullName ? [`--repoFullName=${options.repoFullName}`] : []),
    ...(options.baseBranch ? [`--baseBranch=${options.baseBranch}`] : []),
    ...(options.workingBranch
      ? [`--workingBranch=${options.workingBranch}`]
      : []),
  ]);

  await runRunner(args);
}

async function runRunner(args: RunnerCliArgs): Promise<void> {
  await postRunEvent(args, "runner.started", {
    runId: args.runId,
    executor: args.executor ?? null,
    hasPrompt: Boolean(args.prompt),
    workingDir: args.workingDir,
    repoFullName: args.repoFullName ?? null,
    toolset: DEFAULT_TOOLSET,
  });

  try {
    let repoSummary: Record<string, unknown> | null = null;
    if (args.repoFullName) {
      const prepared = await ensureRepoPrepared(args);
      repoSummary = prepared;
    }

    let delegateSummary: Record<string, unknown> | null = null;

    if (args.executor && args.prompt) {
      const command = buildExecutorCommand(args.executor, args.prompt);

      await postRunEvent(args, "delegate.started", {
        executor: args.executor,
        command,
        maxMinutes: args.maxMinutes,
      });

      const result = await runCommand(
        command,
        args.workingDir,
        args.maxMinutes * 60_000,
      );
      const gitStatus = await runCommand(
        "git status --short",
        args.workingDir,
        60_000,
      );

      delegateSummary = {
        executor: args.executor,
        command,
        result,
        gitStatus,
        summary: summarizeCommandResult(result),
      };

      await postRunEvent(args, "delegate.completed", delegateSummary);

      if (result.exitCode !== 0) {
        throw new Error(
          `${args.executor} command exited with code ${result.exitCode}`,
        );
      }
    }

    const diffStat = args.repoFullName
      ? await runCommand("git diff --stat", args.workingDir, 60_000)
      : null;

    const completedPayload = {
      runId: args.runId,
      repo: repoSummary,
      delegate: delegateSummary,
      diffStat,
      summary:
        delegateSummary?.summary ??
        "Runner completed without delegated executor",
    };

    await postRunEvent(args, "runner.completed", completedPayload);
  } catch (error) {
    await postRunEvent(args, "runner.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

async function runCli(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  await runRunner(args);
}

const executedPath = process.argv[1] ?? "";
const isDirectExecution = import.meta.url === `file://${executedPath}`;

if (isDirectExecution) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
