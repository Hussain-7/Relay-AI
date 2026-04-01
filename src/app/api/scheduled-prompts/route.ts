import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

import { computeNextRunAt, describeCron, validateCronExpression } from "@/lib/inngest/cron-utils";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

const createSchema = z.object({
  prompt: z.string().min(1).max(10000),
  cronExpression: z.string().min(1).refine(validateCronExpression, "Invalid cron expression"),
  timezone: z.string().default("UTC"),
  maxRuns: z.number().int().positive().optional(),
  label: z.string().max(200).optional(),
  repoBindingId: z.string().uuid().optional(),
  preferencesJson: z
    .object({
      model: z.string().optional(),
      thinking: z.boolean().optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
      memory: z.boolean().optional(),
    })
    .optional(),
  mcpConnectorIds: z.array(z.string()).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const where: Record<string, unknown> = {
      userId: user.userId,
      status: { not: "CANCELLED" },
    };

    // Optional date range filter for calendar view
    if (from || to) {
      where.nextRunAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const schedules = await prisma.scheduledPrompt.findMany({
      where,
      orderBy: { nextRunAt: "asc" },
      include: {
        conversation: { select: { id: true, title: true } },
        repoBinding: { select: { id: true, repoFullName: true } },
        _count: { select: { executions: true } },
      },
    });

    const result = schedules.map((s) => ({
      id: s.id,
      prompt: s.prompt,
      cronExpression: s.cronExpression,
      cronDescription: describeCron(s.cronExpression),
      timezone: s.timezone,
      status: s.status,
      maxRuns: s.maxRuns,
      totalRuns: s.totalRuns,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      label: s.label,
      conversationId: s.conversationId,
      conversationTitle: s.conversation?.title ?? null,
      repoBinding: s.repoBinding ? { id: s.repoBinding.id, repoFullName: s.repoBinding.repoFullName } : null,
      preferencesJson: s.preferencesJson,
      mcpConnectorIds: s.mcpConnectorIds,
      executionCount: s._count.executions,
      createdAt: s.createdAt.toISOString(),
    }));

    return Response.json({ schedules: result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list schedules." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = createSchema.parse(await request.json());

    const nextRunAt = computeNextRunAt(body.cronExpression, body.timezone);

    console.log("[schedule:create]", {
      userId: user.userId,
      cron: body.cronExpression,
      timezone: body.timezone,
      nextRunAt: nextRunAt.toISOString(),
      now: new Date().toISOString(),
      prompt: body.prompt.slice(0, 80),
    });

    const schedule = await prisma.scheduledPrompt.create({
      data: {
        userId: user.userId,
        prompt: body.prompt,
        cronExpression: body.cronExpression,
        timezone: body.timezone,
        maxRuns: body.maxRuns ?? null,
        label: body.label ?? null,
        repoBindingId: body.repoBindingId ?? null,
        preferencesJson: body.preferencesJson ?? Prisma.JsonNull,
        mcpConnectorIds: body.mcpConnectorIds ?? Prisma.JsonNull,
        nextRunAt,
      },
    });

    return Response.json(
      {
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
          label: schedule.label,
          createdAt: schedule.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid input", details: error.issues }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create schedule." },
      { status: 500 },
    );
  }
}
