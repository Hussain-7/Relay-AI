import { deleteRepoSecret } from "@/lib/repo-secrets";
import { requireRequestUser } from "@/lib/server-auth";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; secretId: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id, secretId } = await params;
    await deleteRepoSecret(user.userId, id, secretId);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete secret." },
      { status: 400 },
    );
  }
}
