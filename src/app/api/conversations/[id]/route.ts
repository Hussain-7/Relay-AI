import { z } from "zod";

import { deleteConversationForUser, getConversationDetail, updateConversationMainModel } from "@/lib/conversations";
import { requireRequestUser } from "@/lib/server-auth";

const patchConversationSchema = z.object({
  mainAgentModel: z.string().trim().min(1).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const conversation = await getConversationDetail({
      conversationId: id,
      userId: user.userId,
    });

    return Response.json({ conversation });
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

    if (body.mainAgentModel) {
      await updateConversationMainModel({
        conversationId: id,
        userId: user.userId,
        model: body.mainAgentModel,
      });
    }

    const conversation = await getConversationDetail({
      conversationId: id,
      userId: user.userId,
    });

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
