import { Prisma, ProviderId, RunStatus } from "@prisma/client";
import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

export interface QueueCodingRunInput {
  runId: string;
  userId: string;
  apiBaseUrl: string;
  prompt: string;
  preferredProvider?: ProviderId;
  preferredExecutor?: "claude" | "codex";
  maxMinutes?: number;
}

export async function queueCodingRun(input: QueueCodingRunInput) {
  await prisma.agentRun.update({
    where: { id: input.runId },
    data: {
      status: RunStatus.RUNNING,
    },
  });

  try {
    const result = await inngest.send({
      name: "agent/coding-run.requested",
      data: {
        runId: input.runId,
        userId: input.userId,
        apiBaseUrl: input.apiBaseUrl,
        prompt: input.prompt,
        preferredProvider: input.preferredProvider ?? null,
        preferredExecutor: input.preferredExecutor ?? null,
        maxMinutes: input.maxMinutes ?? null,
      },
    });

    await appendRunEvent(input.runId, "runner.enqueued", {
      provider: "inngest",
      payload: {
        preferredProvider: input.preferredProvider ?? null,
        preferredExecutor: input.preferredExecutor ?? null,
        maxMinutes: input.maxMinutes ?? null,
      },
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.agentRun.updateMany({
      where: {
        id: input.runId,
        status: { not: RunStatus.CANCELLED },
      },
      data: {
        status: RunStatus.FAILED,
        endedAt: new Date(),
        finalMessageJson: {
          error: message,
          source: "inngest.queue",
        } as Prisma.InputJsonValue,
      },
    });

    await appendRunEvent(input.runId, "runner.enqueue.failed", {
      source: "inngest.queue",
      error: message,
    });

    await appendRunEvent(input.runId, "run.failed", {
      source: "inngest.queue",
      error: message,
    });

    throw error;
  }
}
