import { Prisma, ProviderId, RunStatus } from "@prisma/client";
import { z } from "zod";
import { dispatchCodingRunner } from "@/lib/runner-dispatch";
import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const codingRunEventSchema = z.object({
  runId: z.string().min(1),
  userId: z.string().min(1),
  apiBaseUrl: z.string().url(),
  prompt: z.string().min(1),
  preferredProvider: z.nativeEnum(ProviderId).nullable().optional(),
  preferredExecutor: z.enum(["claude", "codex"]).nullable().optional(),
  maxMinutes: z.number().int().min(1).max(240).nullable().optional(),
});

export const codingRunDispatchFunction = inngest.createFunction(
  {
    id: "coding-run-dispatch",
  },
  {
    event: "agent/coding-run.requested",
  },
  async ({ event, step }) => {
    const payload = codingRunEventSchema.parse(event.data);

    const run = await step.run("load-run", async () => {
      return prisma.agentRun.findUnique({
        where: { id: payload.runId },
        select: {
          id: true,
          userId: true,
          status: true,
          cancelledAt: true,
        },
      });
    });

    if (!run || run.userId !== payload.userId) {
      await appendRunEvent(payload.runId, "runner.dispatch.skipped", {
        reason: "run_not_found_or_user_mismatch",
      });
      return {
        ok: false,
        reason: "run_not_found_or_user_mismatch",
      };
    }

    if (run.cancelledAt || run.status === RunStatus.CANCELLED) {
      await appendRunEvent(payload.runId, "runner.dispatch.skipped", {
        reason: "run_cancelled",
      });
      return {
        ok: false,
        reason: "run_cancelled",
      };
    }

    try {
      const dispatch = await step.run("dispatch-runner", async () => {
        return dispatchCodingRunner({
          runId: payload.runId,
          userId: payload.userId,
          apiBaseUrl: payload.apiBaseUrl,
          prompt: payload.prompt,
          preferredProvider: payload.preferredProvider ?? undefined,
          preferredExecutor: payload.preferredExecutor ?? undefined,
          maxMinutes: payload.maxMinutes ?? undefined,
        });
      });

      await appendRunEvent(payload.runId, "runner.dispatch.completed", {
        dispatch,
      });

      return {
        ok: true,
        dispatch,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await prisma.agentRun.updateMany({
        where: {
          id: payload.runId,
          status: { not: RunStatus.CANCELLED },
        },
        data: {
          status: RunStatus.FAILED,
          endedAt: new Date(),
          finalMessageJson: {
            error: message,
            source: "inngest.dispatch",
          } as Prisma.InputJsonValue,
        },
      });

      await appendRunEvent(payload.runId, "runner.dispatch.failed", {
        source: "inngest.dispatch",
        error: message,
      });

      await appendRunEvent(payload.runId, "run.failed", {
        source: "inngest.dispatch",
        error: message,
      });

      return {
        ok: false,
        reason: "dispatch_failed",
        error: message,
      };
    }
  },
);

export const inngestFunctions = [codingRunDispatchFunction];
