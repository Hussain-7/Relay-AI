import Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Public (unauthenticated) content route — serves HTML attachments only.
 * Used by the shareable /preview/[id] page.
 * UUIDs are unguessable (128-bit random), so "anyone with the link" is safe.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: { storageUrl: true, anthropicFileId: true, mediaType: true, filename: true },
  });

  if (!attachment || attachment.mediaType !== "text/html") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Proxy HTML from Supabase Storage (redirect doesn't work in sandboxed iframes)
  if (attachment.storageUrl) {
    const res = await fetch(attachment.storageUrl);
    if (res.ok) {
      return new Response(res.body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
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
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": "inline",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      // File may be non-downloadable or expired on Anthropic's servers
    }
  }

  return Response.json({ error: "No content available" }, { status: 404 });
}
