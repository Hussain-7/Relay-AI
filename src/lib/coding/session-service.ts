import { Sandbox } from "@e2b/code-interpreter";
import { CodingSessionStatus } from "@prisma/client";

import { createCodingAgentBootstrapSpec } from "@/lib/coding/agent-runner";
import { appendRunEvent } from "@/lib/run-events";
import { env, hasE2bConfig } from "@/lib/env";
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
