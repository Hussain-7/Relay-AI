import { z } from "zod";

import { createConversationForUser, getConversationDetail, listConversationSummaries } from "@/lib/conversations";
import { requireRequestUser } from "@/lib/server-auth";
import { getCached, invalidateCache } from "@/lib/server-cache";

const createConversationSchema = z.object({
  title: z.string().trim().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const conversations = await getCached(
      `convos:${user.userId}`,
      60,
      () => listConversationSummaries(user.userId),
    );

    return Response.json({ conversations }, {
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to list conversations.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = createConversationSchema.parse(await request.json().catch(() => ({})));
    const conversation = await createConversationForUser({
      userId: user.userId,
      title: body.title,
    });
    const detail = await getConversationDetail({
      conversationId: conversation.id,
      userId: user.userId,
    });

    await invalidateCache(`convos:${user.userId}`);

    return Response.json({ conversation: detail }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create conversation.",
      },
      { status: 500 },
    );
  }
}
