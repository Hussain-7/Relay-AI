import { z } from "zod";

import { computeNextRunAt, describeCron, validateCronExpression } from "@/lib/inngest/cron-utils";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

const updateSchema = z.object({
  prompt: z.string().min(1).max(10000).optional(),
  cronExpression: z.string().min(1).refine(validateCronExpression, "Invalid cron expression").optional(),
  timezone: z.string().optional(),
  maxRuns: z.number().int().positive().nullable().optional(),
  label: z.string().max(200).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;

    const schedule = await prisma.scheduledPrompt.findFirst({
      where: { id, userId: user.userId },
      include: {
        conversation: { select: { id: true, title: true } },
        repoBinding: { select: { id: true, repoFullName: true } },
        executions: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            run: {
              select: {
                id: true,
                status: true,
                finalText: true,
                model: true,
                costUsd: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
    });

    if (!schedule) {
      return Response.json({ error: "Schedule not found" }, { status: 404 });
    }

    return Response.json({
      schedule: {
        id: schedule.id,
        prompt: schedule.prompt,
        cronExpression: schedule.cronExpression,
        cronDescription: describeCron(schedule.cronExpression),
        timezone: schedule.timezone,
        status: schedule.status,
        maxRuns: schedule.maxRuns,
        totalRuns: schedule.totalRuns,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        label: schedule.label,
        conversationId: schedule.conversationId,
        conversationTitle: schedule.conversation?.title ?? null,
        repoBinding: schedule.repoBinding
          ? { id: schedule.repoBinding.id, repoFullName: schedule.repoBinding.repoFullName }
          : null,
        preferencesJson: schedule.preferencesJson,
        mcpConnectorIds: schedule.mcpConnectorIds,
        notifyEmail: schedule.notifyEmail,
        createdAt: schedule.createdAt.toISOString(),
        executions: schedule.executions.map((e) => ({
          id: e.id,
          status: e.status,
          startedAt: e.startedAt?.toISOString() ?? null,
          completedAt: e.completedAt?.toISOString() ?? null,
          errorMessage: e.errorMessage,
          run: e.run
            ? {
                id: e.run.id,
                status: e.run.status,
                finalText: e.run.finalText?.slice(0, 200) ?? null,
                model: e.run.model,
                costUsd: e.run.costUsd,
                createdAt: e.run.createdAt.toISOString(),
                completedAt: e.run.completedAt?.toISOString() ?? null,
              }
            : null,
        })),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get schedule." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const body = updateSchema.parse(await request.json());

    // Verify ownership
    const existing = await prisma.scheduledPrompt.findFirst({
      where: { id, userId: user.userId },
    });
    if (!existing) {
      return Response.json({ error: "Schedule not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (body.prompt !== undefined) data.prompt = body.prompt;
    if (body.label !== undefined) data.label = body.label;
    if (body.maxRuns !== undefined) data.maxRuns = body.maxRuns;
    if (body.status !== undefined) data.status = body.status;

    // If cron or timezone changed, recompute nextRunAt
    if (body.cronExpression !== undefined || body.timezone !== undefined) {
      const cron = body.cronExpression ?? existing.cronExpression;
      const tz = body.timezone ?? existing.timezone;
      data.cronExpression = cron;
      data.timezone = tz;
      if (existing.status === "ACTIVE" || body.status === "ACTIVE") {
        data.nextRunAt = computeNextRunAt(cron, tz);
      }
    }

    // If resuming from paused, recompute nextRunAt
    if (body.status === "ACTIVE" && existing.status === "PAUSED") {
      const cron = (data.cronExpression as string) ?? existing.cronExpression;
      const tz = (data.timezone as string) ?? existing.timezone;
      data.nextRunAt = computeNextRunAt(cron, tz);
    }

    // If pausing, clear nextRunAt
    if (body.status === "PAUSED") {
      data.nextRunAt = null;
    }

    const updated = await prisma.scheduledPrompt.update({
      where: { id },
      data,
    });

    return Response.json({
      schedule: {
        id: updated.id,
        prompt: updated.prompt,
        cronExpression: updated.cronExpression,
        cronDescription: describeCron(updated.cronExpression),
        timezone: updated.timezone,
        status: updated.status,
        maxRuns: updated.maxRuns,
        totalRuns: updated.totalRuns,
        nextRunAt: updated.nextRunAt?.toISOString() ?? null,
        label: updated.label,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update schedule." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;

    const existing = await prisma.scheduledPrompt.findFirst({
      where: { id, userId: user.userId },
    });
    if (!existing) {
      return Response.json({ error: "Schedule not found" }, { status: 404 });
    }

    await prisma.scheduledPrompt.update({
      where: { id },
      data: { status: "CANCELLED", nextRunAt: null },
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete schedule." },
      { status: 500 },
    );
  }
}
