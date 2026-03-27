import { z } from "zod";
import { getLatestCodingSession, startOrResumeCodingSession } from "@/lib/coding/session-service";
import { ensureConversationForUser } from "@/lib/conversations";
import { requireRequestUser } from "@/lib/server-auth";

const codingSessionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    conversationId: z.string().min(1),
    repoBindingId: z.string().optional(),
    taskBrief: z.string().min(1),
    branchStrategy: z.string().optional(),
  }),
  z.object({
    action: z.literal("resume"),
    conversationId: z.string().min(1),
    repoBindingId: z.string().optional(),
    taskBrief: z.string().min(1),
    branchStrategy: z.string().optional(),
  }),
  z.object({
    action: z.literal("status"),
    conversationId: z.string().min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = codingSessionSchema.parse(await request.json());

    await ensureConversationForUser({
      conversationId: body.conversationId,
      userId: user.userId,
    });

    switch (body.action) {
      case "start":
      case "resume": {
        const session = await startOrResumeCodingSession({
          conversationId: body.conversationId,
          userId: user.userId,
          repoBindingId: body.repoBindingId,
          taskBrief: body.taskBrief,
          branchStrategy: body.branchStrategy,
        });

        return Response.json({ codingSession: session });
      }
      case "status": {
        const session = await getLatestCodingSession(body.conversationId);

        return Response.json({ codingSession: session });
      }
    }
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to manage coding session.",
      },
      { status: 500 },
    );
  }
}
