import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { connectSandbox, createSandbox } from "@/lib/e2b-runtime";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { appendRunEvent } from "@/lib/run-events";

const connectSchema = z.object({
  userId: z.string().optional(),
  timeoutMs: z.number().int().min(60_000).max(7_200_000).default(1_800_000),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = connectSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const session = await prisma.codingSession.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Coding session not found" },
        { status: 404 },
      );
    }

    let sandboxId = session.sandboxId;

    if (sandboxId) {
      const sandbox = await connectSandbox(sandboxId);
      await sandbox.setTimeout(body.timeoutMs);
    } else {
      const sandbox = await createSandbox(body.timeoutMs, {
        userId: auth.userId,
        codingSessionId: session.id,
        runId: session.runId ?? "",
      });
      sandboxId = sandbox.sandboxId;
    }

    const updated = await prisma.codingSession.update({
      where: { id: session.id },
      data: {
        sandboxId,
        status: "connected",
      },
    });

    if (updated.runId) {
      await appendRunEvent(updated.runId, "coding.session.connected", {
        codingSessionId: updated.id,
        sandboxId: updated.sandboxId,
      });
    }

    return NextResponse.json({
      codingSessionId: updated.id,
      containerSessionId: updated.sandboxId,
      status: updated.status,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
