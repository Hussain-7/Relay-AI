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
    select: { content: true, mediaType: true, filename: true },
  });

  if (!attachment?.content || attachment.mediaType !== "text/html") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = new Uint8Array(attachment.content);

  return new Response(bytes, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
