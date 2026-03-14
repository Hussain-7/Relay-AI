import { z } from "zod";

import { connectRepoBinding } from "@/lib/github/service";
import { requireRequestUser } from "@/lib/server-auth";

const connectSchema = z.object({
  repoFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
});

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = connectSchema.parse(await request.json());
    const binding = await connectRepoBinding({
      userId: user.userId,
      repoFullName: body.repoFullName,
    });
    return Response.json({
      binding: {
        id: binding.id,
        repoFullName: binding.repoFullName,
        defaultBranch: binding.defaultBranch,
        installationId: binding.installationId,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to connect repo." },
      { status: 400 },
    );
  }
}
