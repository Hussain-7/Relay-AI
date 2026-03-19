import { RunStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { setStopFlag } from "@/lib/run-stop";
import { requireRequestUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id: runId } = await params;

    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { userId: true, status: true },
    });

    if (!run) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.userId !== user.userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (run.status !== RunStatus.RUNNING) {
      return Response.json({ error: "Run is not active" }, { status: 409 });
    }

    await setStopFlag(runId);

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to stop run." },
      { status: 500 },
    );
  }
}
