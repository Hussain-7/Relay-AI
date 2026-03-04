import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProviderId, RunStatus } from "@prisma/client";
import { createSandbox, execInSandbox } from "@/lib/e2b-runtime";
import { createInstallationToken } from "@/lib/github-app";
import { prisma } from "@/lib/prisma";
import { getActiveProviderCredentials } from "@/lib/provider-credentials";
import { appendRunEvent } from "@/lib/run-events";

export interface DispatchCodingRunnerInput {
  runId: string;
  userId: string;
  apiBaseUrl: string;
  prompt: string;
  preferredProvider?: ProviderId;
  preferredExecutor?: "claude" | "codex";
  maxMinutes?: number;
}

export interface DispatchCodingRunnerResult {
  runId: string;
  codingSessionId: string;
  sandboxId: string;
  pid: string | null;
  executor: "claude" | "codex";
  logPath: string;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getRunnerEventToken(): string {
  const token = process.env.RUNNER_EVENT_TOKEN;
  if (!token) {
    throw new Error(
      "RUNNER_EVENT_TOKEN is required to dispatch async coding runners",
    );
  }
  return token;
}

async function resolveCodingSession(input: { runId: string; userId: string }) {
  const session = await prisma.codingSession.findFirst({
    where: {
      runId: input.runId,
      userId: input.userId,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    throw new Error("No coding session found for run");
  }

  if (session.sandboxId) {
    return session;
  }

  const sandbox = await createSandbox(1_800_000, {
    runId: input.runId,
    codingSessionId: session.id,
    userId: input.userId,
  });

  return prisma.codingSession.update({
    where: { id: session.id },
    data: {
      sandboxId: sandbox.sandboxId,
      status: "connected",
    },
  });
}

function resolveExecutor(input: {
  preferredProvider?: ProviderId;
  preferredExecutor?: "claude" | "codex";
  hasOpenAI: boolean;
  hasAnthropic: boolean;
}): "claude" | "codex" {
  if (input.preferredExecutor) {
    if (input.preferredExecutor === "codex" && !input.hasOpenAI) {
      throw new Error("Codex executor requires an active OpenAI key");
    }

    if (input.preferredExecutor === "claude" && !input.hasAnthropic) {
      throw new Error("Claude executor requires an active Anthropic key");
    }

    return input.preferredExecutor;
  }

  if (input.preferredProvider === ProviderId.OPENAI && input.hasOpenAI) {
    return "codex";
  }

  if (input.preferredProvider === ProviderId.ANTHROPIC && input.hasAnthropic) {
    return "claude";
  }

  if (input.hasOpenAI) {
    return "codex";
  }

  if (input.hasAnthropic) {
    return "claude";
  }

  throw new Error("No provider credentials available for runner executor");
}

async function stageRunnerScriptInSandbox(sandboxId: string): Promise<string> {
  const distPath = path.join(process.cwd(), "packages/runner/dist/index.js");
  const script = await readFile(distPath, "utf8");
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const scriptPath = "/workspace/endless-runner/index.mjs";

  await execInSandbox(sandboxId, {
    command: `mkdir -p /workspace/endless-runner && echo ${shellEscape(encoded)} | base64 --decode > ${shellEscape(scriptPath)} && chmod +x ${shellEscape(scriptPath)}`,
    timeoutMs: 120_000,
  });

  return scriptPath;
}

async function getGithubToken(userId: string): Promise<string | null> {
  const installation = await prisma.githubInstallation.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { installationId: true },
  });

  if (!installation) {
    return null;
  }

  return createInstallationToken(installation.installationId);
}

export async function dispatchCodingRunner(
  input: DispatchCodingRunnerInput,
): Promise<DispatchCodingRunnerResult> {
  const session = await resolveCodingSession({
    runId: input.runId,
    userId: input.userId,
  });

  if (!session.sandboxId) {
    throw new Error("Coding session is missing sandboxId after resolution");
  }

  const credentials = await getActiveProviderCredentials(input.userId);
  const openai = credentials.find(
    (item) => item.provider === ProviderId.OPENAI,
  );
  const anthropic = credentials.find(
    (item) => item.provider === ProviderId.ANTHROPIC,
  );

  const executor = resolveExecutor({
    preferredProvider: input.preferredProvider,
    preferredExecutor: input.preferredExecutor,
    hasOpenAI: Boolean(openai),
    hasAnthropic: Boolean(anthropic),
  });

  const githubToken = await getGithubToken(input.userId);
  const runnerScriptPath = await stageRunnerScriptInSandbox(session.sandboxId);

  const logPath = `/tmp/endless-runner-${input.runId}.log`;
  const commandParts = [
    `nohup node ${shellEscape(runnerScriptPath)}`,
    `--runId=${shellEscape(input.runId)}`,
    `--apiBaseUrl=${shellEscape(input.apiBaseUrl)}`,
    `--eventToken=${shellEscape(getRunnerEventToken())}`,
    `--executor=${shellEscape(executor)}`,
    `--prompt=${shellEscape(input.prompt)}`,
    `--workingDir=${shellEscape("/workspace/repo")}`,
    `--maxMinutes=${shellEscape(String(input.maxMinutes ?? 45))}`,
    `--repoFullName=${shellEscape(session.repoFullName)}`,
    `--baseBranch=${shellEscape(session.baseBranch)}`,
    `--workingBranch=${shellEscape(session.workingBranch)}`,
    `> ${shellEscape(logPath)} 2>&1 & echo $!`,
  ];

  const envs: Record<string, string> = {};
  if (openai) {
    envs.OPENAI_API_KEY = openai.apiKey;
  }
  if (anthropic) {
    envs.ANTHROPIC_API_KEY = anthropic.apiKey;
  }
  if (githubToken) {
    envs.GITHUB_TOKEN = githubToken;
  }

  const launch = await execInSandbox(session.sandboxId, {
    command: commandParts.join(" "),
    timeoutMs: 60_000,
    envs,
  });

  const pid =
    launch.stdout
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .pop() ?? null;

  await prisma.agentRun.update({
    where: { id: input.runId },
    data: {
      status: RunStatus.RUNNING,
    },
  });

  await appendRunEvent(input.runId, "runner.dispatched", {
    codingSessionId: session.id,
    sandboxId: session.sandboxId,
    executor,
    pid,
    logPath,
    launch,
  });

  return {
    runId: input.runId,
    codingSessionId: session.id,
    sandboxId: session.sandboxId,
    pid,
    executor,
    logPath,
  };
}
