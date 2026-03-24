import { z } from "zod";

import { deleteConversationForUser, getConversationDetail, toggleConversationStar, updateConversationMainModel, updateConversationRepoBinding, updateConversationTitle } from "@/lib/conversations";
import { requireRequestUser } from "@/lib/server-auth";
import { getCached, invalidateCache } from "@/lib/server-cache";

const patchConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  isStarred: z.boolean().optional(),
  mainAgentModel: z.string().trim().min(1).optional(),
  repoBindingId: z.string().nullable().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const conversation = await getCached(
      `conv:${id}`,
      120,
      () => getConversationDetail({ conversationId: id, userId: user.userId }),
    );

    return Response.json({ conversation }, {
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Conversation not found.",
      },
      { status: 404 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;

    await deleteConversationForUser({
      conversationId: id,
      userId: user.userId,
    });

    await invalidateCache(`convos:${user.userId}`, `conv:${id}`);

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Conversation not found.",
      },
      { status: 404 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const body = patchConversationSchema.parse(await request.json());

    if (body.title) {
      await updateConversationTitle({
        conversationId: id,
        userId: user.userId,
        title: body.title,
      });
    }

    if (body.isStarred !== undefined) {
      await toggleConversationStar({
        conversationId: id,
        userId: user.userId,
        isStarred: body.isStarred,
      });
    }

    if (body.mainAgentModel) {
      await updateConversationMainModel({
        conversationId: id,
        userId: user.userId,
        model: body.mainAgentModel,
      });
    }

    if (body.repoBindingId !== undefined) {
      await updateConversationRepoBinding({
        conversationId: id,
        userId: user.userId,
        repoBindingId: body.repoBindingId,
      });
    }

    const conversation = await getConversationDetail({
      conversationId: id,
      userId: user.userId,
    });

    await invalidateCache(`conv:${id}`, `convos:${user.userId}`);

    return Response.json({ conversation });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to update conversation.",
      },
      { status: 400 },
    );
  }
}
