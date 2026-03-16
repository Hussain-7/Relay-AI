import { z } from "zod";

import { ensureConversationForUser } from "@/lib/conversations";
import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { requireRequestUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const createMessageSchema = z.object({
  prompt: z.string().trim().min(1),
  attachmentIds: z.array(z.string()).default([]),
  preferences: z.object({
    thinking: z.boolean().default(false),
    effort: z.enum(["low", "medium", "high"]).default("low"),
    memory: z.boolean().default(false),
  }).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const body = createMessageSchema.parse(await request.json());

    await ensureConversationForUser({
      conversationId: id,
      userId: user.userId,
    });

    const run = await streamMainAgentRun({
      conversationId: id,
      userId: user.userId,
      prompt: body.prompt,
      attachmentIds: body.attachmentIds,
      preferences: body.preferences,
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
        error: error instanceof Error ? error.message : "Failed to start the agent run.",
      },
      { status: 500 },
    );
  }
}
