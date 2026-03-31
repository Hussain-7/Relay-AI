import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

/**
 * Serves attachment content. New attachments use storageUrl (Supabase CDN) directly
 * via the attachment chip — this route is the fallback for:
 * 1. Old attachments without storageUrl (pre-migration) → Anthropic Files API
 * 2. Non-image attachments (PDFs, documents) that need authenticated proxy
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRequestUser(request.headers);

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      storageUrl: true,
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

  // Sanitize filename for Content-Disposition
  const rawFilename = attachment.filename;
  const asciiFilename = rawFilename.replace(/[^\x20-\x7E]/g, "_");
  const encodedFilename = encodeURIComponent(rawFilename).replace(/'/g, "%27");
  const dispositionHeader = `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;

  // Prefer Supabase Storage URL — redirect to CDN
  if (attachment.storageUrl) {
    return Response.redirect(attachment.storageUrl, 302);
  }

  // Fall back to streaming from Anthropic Files API (old pre-migration attachments)
  if (attachment.anthropicFileId) {
    try {
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
    } catch {
      // File may be non-downloadable or expired on Anthropic's servers
    }
  }

  return Response.json({ error: "No content available" }, { status: 404 });
}
