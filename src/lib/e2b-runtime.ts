import { Sandbox } from "@e2b/code-interpreter";

export interface ExecCommandInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  envs?: Record<string, string>;
}

export interface ExecCommandResult {
  command: string;
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

function getE2BApiKey(): string {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error("E2B_API_KEY is required for coding sessions");
  }
  return apiKey;
}

export async function createSandbox(
  timeoutMs = 60 * 60 * 1000,
  metadata?: Record<string, string>,
) {
  const sandbox = await Sandbox.create({
    apiKey: getE2BApiKey(),
    timeoutMs,
    metadata,
  });

  return sandbox;
}

export async function connectSandbox(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: getE2BApiKey(),
  });
  return sandbox;
}

export async function execInSandbox(
  sandboxId: string,
  input: ExecCommandInput,
): Promise<ExecCommandResult> {
  const sandbox = await connectSandbox(sandboxId);
  const result = await sandbox.commands.run(input.command, {
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    envs: input.envs,
  });

  return {
    command: input.command,
    cwd: input.cwd,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    error: result.error,
  };
}

export async function extendSandboxTimeout(
  sandboxId: string,
  timeoutMs: number,
): Promise<void> {
  const sandbox = await connectSandbox(sandboxId);
  await sandbox.setTimeout(timeoutMs);
}
