import { z } from "zod";

import { listRepoSecrets, upsertRepoSecrets } from "@/lib/repo-secrets";
import { requireRequestUser } from "@/lib/server-auth";

const putSecretsSchema = z.object({
  secrets: z
    .array(
      z.object({
        key: z.string().min(1).max(256),
        value: z.string().min(1).max(10000),
      }),
    )
    .min(1)
    .max(50),
});

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
    const body = putSecretsSchema.parse(await request.json());

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
