import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";
import { requireRequestUser } from "@/lib/server-auth";

const approveSchema = z.object({
  approvalId: z.string().min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
  responseJson: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const body = approveSchema.parse(await request.json());

    const run = await prisma.agentRun.findFirst({
      where: {
        id,
        userId: user.userId,
      },
      select: { id: true, conversationId: true },
    });

    if (!run) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }

    const approval = await prisma.runApproval.update({
      where: { id: body.approvalId },
      data: {
        status: body.status,
        responseJson: (body.responseJson ?? {}) as Prisma.InputJsonValue,
        resolvedAt: new Date(),
      },
    });

    // Persist the resolved event so it survives page reloads and broadcasts via Realtime
    await appendRunEvent({
      runId: id,
      conversationId: run.conversationId,
      type: "approval.resolved",
      source: "user",
      payload: {
        approvalId: body.approvalId,
        status: body.status,
        response: body.responseJson ?? null,
      },
    });

    return Response.json({ approval });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve approval.",
      },
      { status: 500 },
    );
  }
}
