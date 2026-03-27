import { listRepoSecrets, upsertRepoSecrets } from "@/lib/repo-secrets";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const secrets = await listRepoSecrets(user.userId, id);
    return Response.json({ secrets });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list secrets." },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request.headers);
    const { id } = await params;
    const body = (await request.json()) as { secrets?: { key: string; value: string }[] };

    if (!Array.isArray(body.secrets)) {
      return Response.json({ error: "secrets array is required." }, { status: 400 });
    }

    await upsertRepoSecrets(user.userId, id, body.secrets);
    const secrets = await listRepoSecrets(user.userId, id);
    return Response.json({ secrets });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save secrets." },
      { status: 400 },
    );
  }
}
