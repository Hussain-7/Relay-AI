import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRequestUser(request.headers);

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      content: true,
      anthropicFileId: true,
      mediaType: true,
      filename: true,
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

  // Sanitize filename for Content-Disposition: ASCII fallback + RFC 5987 UTF-8 variant
  const rawFilename = attachment.filename;
  const asciiFilename = rawFilename.replace(/[^\x20-\x7E]/g, "_");
  const encodedFilename = encodeURIComponent(rawFilename).replace(/'/g, "%27");
  const dispositionHeader = `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;

  // Prefer local content; fall back to streaming from Anthropic Files API
  if (attachment.content) {
    const bytes = new Uint8Array(attachment.content);
    return new Response(bytes, {
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Disposition": dispositionHeader,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
      },
    });
  }

  if (attachment.anthropicFileId) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const downloaded = await client.beta.files.download(attachment.anthropicFileId, {
      betas: ["files-api-2025-04-14"],
    });
    return new Response(downloaded.body as ReadableStream, {
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Disposition": dispositionHeader,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
