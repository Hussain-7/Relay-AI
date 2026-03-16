import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(
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

  if (!attachment?.anthropicFileId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Verify ownership through conversation or run
  const ownerUserId = attachment.conversation?.userId ?? attachment.run?.userId;
  if (ownerUserId !== user.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const fileContent = await client.beta.files.download(
    attachment.anthropicFileId,
    { betas: ["files-api-2025-04-14"] },
  );

  return new Response(fileContent.body as ReadableStream, {
    headers: {
      "Content-Type": attachment.mediaType,
      "Content-Disposition": `attachment; filename="${attachment.filename}"`,
    },
  });
}
