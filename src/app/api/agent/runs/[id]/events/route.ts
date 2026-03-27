import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;

    const run = await prisma.agentRun.findFirst({
      where: {
        id,
        userId: user.userId,
      },
      select: {
        id: true,
        conversationId: true,
        events: {
          orderBy: [{ ts: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!run) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }

    return Response.json({
      runId: run.id,
      conversationId: run.conversationId,
      events: run.events.map((event) => ({
        id: event.id,
        runId: event.runId,
        conversationId: run.conversationId,
        type: event.type,
        ts: event.ts.toISOString(),
        payload: event.payloadJson,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to load run events.",
      },
      { status: 500 },
    );
  }
}
