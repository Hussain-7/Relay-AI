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
    select: {
      content: true,
      mediaType: true,
      filename: true,
      conversation: { select: { userId: true } },
      run: { select: { userId: true } },
    },
  });

  if (!attachment?.content) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const ownerUserId = attachment.conversation?.userId ?? attachment.run?.userId;
  if (ownerUserId !== user.userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Convert Prisma Buffer to Uint8Array for Response compatibility
  const bytes = new Uint8Array(attachment.content);

  return new Response(bytes, {
    headers: {
      "Content-Type": attachment.mediaType,
      "Content-Disposition": `inline; filename="${attachment.filename}"`,
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
