import { Sandbox } from "@e2b/code-interpreter";
import { CodingSessionStatus } from "@prisma/client";

import { createCodingAgentBootstrapSpec } from "@/lib/coding/agent-runner";
import { appendRunEvent } from "@/lib/run-events";
import { env, hasE2bConfig, hasGitHubAppConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const DEFAULT_WORKSPACE_ROOT = "/workspace";

function getSandboxTemplate() {
  return env.E2B_TEMPLATE || env.E2B_TEMPLATE_ID || "code-interpreter-v1";
}

async function connectSandboxOrThrow(sandboxId: string) {
  if (!hasE2bConfig()) {
    throw new Error("E2B_API_KEY is required for coding sessions.");
  }

  return Sandbox.connect(sandboxId, {
    apiKey: env.E2B_API_KEY,
    timeoutMs: 1000 * 60 * 20,
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
    await sandbox.setTimeout(1000 * 60 * 20);

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
    timeoutMs: 1000 * 60 * 20,
    metadata: {
      conversationId: input.conversationId,
      userId: input.userId,
    },
    allowInternetAccess: true,
  });

  await sandbox.files.makeDir(workspacePath);

  if (repoBinding) {
    await sandbox.files.write(
      `${workspacePath}/README.relay-ai.md`,
      [
        `# ${repoBinding.repoFullName}`,
        "",
        "This coding workspace was provisioned by Relay AI.",
        "",
        "The full remote Claude Code runner handoff is scaffolded in the app layer.",
        "Clone and authenticated git operations should be completed by the dedicated runner service.",
      ].join("\n"),
    );
  }

  const bootstrapSpec = createCodingAgentBootstrapSpec({
    prompt:
      input.taskBrief ??
      "Inspect the workspace, summarize the current repo state, and wait for the next delegated coding task.",
    cwd: workspacePath,
  });

  await sandbox.files.write(
    `${workspacePath}/.relay-ai.coding-agent.json`,
    JSON.stringify(bootstrapSpec, null, 2),
  );

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
 * Returns the sandbox instance for further commands.
 */
async function ensureRepoCloned(session: {
  sandboxId: string;
  workspacePath: string | null;
  repoBinding: { repoFullName: string } | null;
}, userId: string) {
  const sandbox = await Sandbox.connect(session.sandboxId, {
    apiKey: env.E2B_API_KEY,
    timeoutMs: 1000 * 60 * 20,
  });

  if (!session.repoBinding || !session.workspacePath) return sandbox;

  const cloneCheck = await sandbox.commands.run(
    `test -d "${session.workspacePath}/.git" && echo "exists" || echo "missing"`,
  );

  if (cloneCheck.stdout.trim() === "exists") return sandbox;

  const installation = await prisma.githubInstallation.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  if (!installation || !hasGitHubAppConfig()) {
    throw new Error("GitHub App is not installed. Cannot clone the repository.");
  }

  const { Octokit } = await import("octokit");
  const { createAppAuth } = await import("@octokit/auth-app");

  const appClient = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: env.GITHUB_APP_PRIVATE_KEY!,
      installationId: Number(installation.installationId),
    },
  });

  const { data: tokenData } = await appClient.request(
    "POST /app/installations/{installation_id}/access_tokens",
    { installation_id: Number(installation.installationId) },
  );

  const cloneUrl = `https://x-access-token:${tokenData.token}@github.com/${session.repoBinding.repoFullName}.git`;

  await sandbox.commands.run(
    `git clone ${cloneUrl} "${session.workspacePath}"`,
    { timeoutMs: 60000 },
  );
  await sandbox.commands.run(
    `cd "${session.workspacePath}" && git config user.email "relay-ai@users.noreply.github.com" && git config user.name "Relay AI"`,
  );

  // Configure credential helper so pushes work
  const repoFullName = session.repoBinding.repoFullName;
  await sandbox.commands.run(
    `cd "${session.workspacePath}" && git remote set-url origin https://x-access-token:${tokenData.token}@github.com/${repoFullName}.git`,
  );

  return sandbox;
}

/**
 * Clone the repo, run the coding agent CLI inside E2B, and return the result.
 * The coding agent is a pre-built TypeScript CLI that uses the Claude Agent SDK.
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

  // Clone repo into sandbox
  const sandbox = await ensureRepoCloned(
    {
      sandboxId: session.sandboxId,
      workspacePath: session.workspacePath,
      repoBinding: session.repoBinding,
    },
    input.userId,
  );

  // Update session to RUNNING
  await prisma.codingSession.update({
    where: { id: session.id },
    data: { status: CodingSessionStatus.RUNNING, lastActiveAt: new Date() },
  });

  await appendRunEvent({
    runId: input.runId,
    conversationId: input.conversationId,
    type: "coding.session.ready",
    source: "coding_agent",
    payload: { status: "cloned", workspacePath: session.workspacePath },
  });

  // Ensure the coding agent CLI is available in the sandbox
  const hasAgent = await sandbox.commands.run("command -v relay-agent > /dev/null 2>&1 && echo yes || echo no");
  if (hasAgent.stdout.trim() !== "yes") {
    // Upload the built CLI to the sandbox (fallback for non-custom templates)
    const fs = await import("fs");
    const path = await import("path");

    const agentPkgDir = path.resolve(process.cwd(), "packages/coding-agent");
    const cliJs = fs.readFileSync(path.join(agentPkgDir, "dist/cli.js"), "utf-8");
    const pkgJson = fs.readFileSync(path.join(agentPkgDir, "package.json"), "utf-8");

    await sandbox.commands.run("mkdir -p /opt/relay-agent/dist");
    await sandbox.files.write("/opt/relay-agent/package.json", pkgJson);
    await sandbox.files.write("/opt/relay-agent/dist/cli.js", `#!/usr/bin/env node\n${cliJs}`);
    await sandbox.commands.run("cd /opt/relay-agent && npm install --production 2>/dev/null", { timeoutMs: 60000 });
    await sandbox.commands.run("chmod +x /opt/relay-agent/dist/cli.js && ln -sf /opt/relay-agent/dist/cli.js /usr/local/bin/relay-agent");
  }

  // Escape the task for shell
  const escapedTask = input.taskBrief.replace(/'/g, "'\\''");
  const resumeFlag = session.claudeSdkSessionId
    ? ` --resume '${session.claudeSdkSessionId}'`
    : "";

  // Run the coding agent
  const agentResult = await sandbox.commands.run(
    `cd "${session.workspacePath}" && ANTHROPIC_API_KEY="${env.ANTHROPIC_API_KEY}" relay-agent --task '${escapedTask}' --cwd '${session.workspacePath}'${resumeFlag}`,
    { timeoutMs: 1000 * 60 * 10 }, // 10 minute timeout
  );

  // Parse structured events from stdout
  const events: Array<Record<string, unknown>> = [];
  let agentSessionId: string | null = null;
  let finalResult = "";

  for (const line of agentResult.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      events.push(event);

      if (event.type === "session.init") {
        agentSessionId = event.sessionId as string;
      }
      if (event.type === "result") {
        finalResult = typeof event.result === "string"
          ? event.result
          : JSON.stringify(event.result);
      }
    } catch {
      // Non-JSON line, skip
    }
  }

  // Emit key events to the timeline
  for (const event of events) {
    if (event.type === "tool.start" || event.type === "tool.result" || event.type === "agent.error") {
      await appendRunEvent({
        runId: input.runId,
        conversationId: input.conversationId,
        type: "tool.call.completed",
        source: "coding_agent",
        payload: event,
      });
    }
  }

  // Update session back to READY with the agent session ID for resumption
  await prisma.codingSession.update({
    where: { id: session.id },
    data: {
      status: CodingSessionStatus.READY,
      claudeSdkSessionId: agentSessionId,
      lastActiveAt: new Date(),
    },
  });

  return {
    result: finalResult || agentResult.stderr.slice(0, 2000) || "Agent completed with no output.",
    sessionId: agentSessionId,
    exitCode: agentResult.exitCode,
    sandboxId: session.sandboxId,
    workspacePath: session.workspacePath,
    repoFullName: session.repoBinding?.repoFullName ?? null,
    branch: session.branch,
    eventCount: events.length,
  };
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
