import Anthropic from "@anthropic-ai/sdk";

import { env, hasAnthropicApiKey } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireRequestUser(request.headers);

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      conversation: { select: { userId: true } },
      run: { select: { userId: true } },
    },
  });

  if (!attachment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const ownerUserId = attachment.conversation?.userId ?? attachment.run?.userId;
  if (ownerUserId !== user.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete from Anthropic Files API if we have a file ID
  if (attachment.anthropicFileId && hasAnthropicApiKey()) {
    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      await client.beta.files.delete(attachment.anthropicFileId, {
        betas: ["files-api-2025-04-14"],
      });
    } catch {
      // Best-effort: if Anthropic delete fails (already deleted, network error),
      // still remove from our DB to avoid orphaned records
    }
  }

  await prisma.attachment.delete({ where: { id } });

  return Response.json({ ok: true });
}
