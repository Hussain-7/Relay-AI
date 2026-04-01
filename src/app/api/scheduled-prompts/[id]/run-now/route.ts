import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;

    const schedule = await prisma.scheduledPrompt.findFirst({
      where: { id, userId: user.userId },
    });
    if (!schedule) {
      return Response.json({ error: "Schedule not found" }, { status: 404 });
    }
    if (schedule.status === "CANCELLED") {
      return Response.json({ error: "Cannot run a cancelled schedule" }, { status: 400 });
    }

    // Send an immediate execute event
    await inngest.send({
      name: "scheduled-prompt/execute",
      data: {
        scheduledPromptId: id,
        nextRunAt: new Date().toISOString(),
      },
      id: `manual-${id}-${Date.now()}`,
    });

    return Response.json({ success: true, message: "Execution triggered" });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to trigger execution." },
      { status: 500 },
    );
  }
}
