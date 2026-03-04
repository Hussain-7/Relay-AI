import { Prisma, RunStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const ingestEventSchema = z.object({
  type: z.string().min(1),
  payload: z.any(),
  ts: z.string().datetime().optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function resolveRunnerExecutor(payload: unknown): "claude" | "codex" | null {
  const body = asRecord(payload);
  const direct = getNonEmptyString(body.executor);
  if (direct === "claude" || direct === "codex") {
    return direct;
  }

  const delegate = asRecord(body.delegate);
  const nested = getNonEmptyString(delegate.executor);
  if (nested === "claude" || nested === "codex") {
    return nested;
  }

  return null;
}

function buildCompletionText(payload: unknown): string {
  const body = asRecord(payload);
  const rootSummary = getNonEmptyString(body.summary);
  const delegateSummary = getNonEmptyString(asRecord(body.delegate).summary);
  const summary = rootSummary ?? delegateSummary ?? "Coding run completed.";

  const diffStat = asRecord(body.diffStat);
  const diffText = getNonEmptyString(diffStat.stdout);
  if (!diffText) {
    return summary;
  }

  const preview = truncate(diffText, 1200);
  return `${summary}\n\nDiff summary:\n${preview}`;
}

function buildFailureReason(payload: unknown): string {
  const body = asRecord(payload);
  return getNonEmptyString(body.reason) ?? "Coding run failed.";
}

async function createAssistantMessage(params: {
  conversationId: string;
  text: string;
  executor: "claude" | "codex" | null;
}): Promise<string> {
  const modelId = params.executor ? `runner:${params.executor}` : "runner";
  const message = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: "assistant",
      contentJson: { text: params.text } as Prisma.InputJsonValue,
      modelId,
    },
  });

  return message.id;
}

function extractExistingMessageId(finalMessageJson: unknown): string | null {
  const final = asRecord(finalMessageJson);
  return getNonEmptyString(final.messageId);
}

function getRunnerEventToken() {
  const token = process.env.RUNNER_EVENT_TOKEN;
  if (!token) {
    throw new Error("RUNNER_EVENT_TOKEN is not configured");
  }
  return token;
}

function assertRunnerAuthorized(request: NextRequest): void {
  const supplied = request.headers.get("x-runner-token");
  if (!supplied || supplied !== getRunnerEventToken()) {
    throw new Error("Unauthorized runner token");
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertRunnerAuthorized(request);
    const body = ingestEventSchema.parse(await request.json());
    const { id } = await context.params;

    const run = await prisma.agentRun.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        cancelledAt: true,
        conversationId: true,
        finalMessageJson: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const event = await appendRunEvent(run.id, body.type, body.payload);
    const eventTs = body.ts ? new Date(body.ts) : event.ts;

    if (body.ts) {
      await prisma.runEvent.update({
        where: { id: event.id },
        data: {
          ts: new Date(body.ts),
        },
      });
    }

    if (!run.cancelledAt && run.status !== RunStatus.CANCELLED) {
      if (body.type === "runner.started" && run.status === RunStatus.CREATED) {
        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.RUNNING,
          },
        });

        await appendRunEvent(run.id, "run.started", {
          mode: "CODING",
          executionTarget: "E2B",
          source: "runner",
        });
      }

      if (
        body.type === "runner.completed" &&
        run.status !== RunStatus.COMPLETED &&
        run.status !== RunStatus.FAILED
      ) {
        const text = buildCompletionText(body.payload);
        const executor = resolveRunnerExecutor(body.payload);
        const existingMessageId = extractExistingMessageId(
          run.finalMessageJson,
        );
        const messageId =
          existingMessageId ??
          (await createAssistantMessage({
            conversationId: run.conversationId,
            text,
            executor,
          }));

        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.COMPLETED,
            endedAt: eventTs,
            finalMessageJson: {
              text,
              messageId,
              source: "runner",
              executor,
            } as Prisma.InputJsonValue,
          },
        });

        await appendRunEvent(run.id, "run.completed", {
          source: "runner",
          text,
          messageId,
          executor,
        });
      }

      if (
        body.type === "runner.failed" &&
        run.status !== RunStatus.COMPLETED &&
        run.status !== RunStatus.FAILED
      ) {
        const reason = buildFailureReason(body.payload);
        const text = `Coding run failed: ${reason}`;
        const executor = resolveRunnerExecutor(body.payload);
        const existingMessageId = extractExistingMessageId(
          run.finalMessageJson,
        );
        const messageId =
          existingMessageId ??
          (await createAssistantMessage({
            conversationId: run.conversationId,
            text,
            executor,
          }));

        await prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.FAILED,
            endedAt: eventTs,
            finalMessageJson: {
              error: reason,
              text,
              messageId,
              source: "runner",
              executor,
            } as Prisma.InputJsonValue,
          },
        });

        await appendRunEvent(run.id, "run.failed", {
          source: "runner",
          error: reason,
          messageId,
          executor,
        });
      }
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
