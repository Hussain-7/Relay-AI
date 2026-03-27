import { deleteRepoBinding } from "@/lib/github/service";
import { requireRequestUser } from "@/lib/server-auth";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    await deleteRepoBinding(user.userId, id);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete repo binding." },
      { status: 400 },
    );
  }
}
