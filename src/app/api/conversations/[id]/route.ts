import { deleteConversationForUser, getConversationDetail } from "@/lib/conversations";
import { requireRequestUser } from "@/lib/server-auth";

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
