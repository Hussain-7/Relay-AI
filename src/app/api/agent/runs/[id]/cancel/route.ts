import { RunStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const cancelSchema = z.object({
  userId: z.string().optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const rawBody = await request.text();
    const body = rawBody ? cancelSchema.parse(JSON.parse(rawBody)) : {};

    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const run = await prisma.agentRun.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const cancelledAt = new Date();
    const updated = await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.CANCELLED,
        cancelledAt,
        endedAt: run.endedAt ?? cancelledAt,
      },
    });

    await appendRunEvent(run.id, "run.cancelled", {
      cancelledAt: cancelledAt.toISOString(),
    });

    return NextResponse.json({
      run: updated,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
