import { z } from "zod";

import { ensureConversationForUser } from "@/lib/conversations";
import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { requireRequestUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const createRunSchema = z.object({
  conversationId: z.string().min(1),
  prompt: z.string().trim().min(1),
  attachmentIds: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = createRunSchema.parse(await request.json());

    await ensureConversationForUser({
      conversationId: body.conversationId,
      userId: user.userId,
    });

    const run = await streamMainAgentRun({
      conversationId: body.conversationId,
      userId: user.userId,
      prompt: body.prompt,
      attachmentIds: body.attachmentIds,
    });

    return new Response(run.stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to start run.",
      },
      { status: 500 },
    );
  }
}
