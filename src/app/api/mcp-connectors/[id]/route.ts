import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

const patchSchema = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireRequestUser(request.headers);
  const { id } = await params;
  const body = patchSchema.parse(await request.json());

  const connector = await prisma.mcpConnector.findUnique({ where: { id } });
  if (!connector || connector.userId !== user.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Only toggle between ACTIVE and DISABLED; don't override NEEDS_AUTH/ERROR
  const currentStatus = connector.status;
  let nextStatus = currentStatus;

  if (body.enabled) {
    // Re-enable: if it was DISABLED, restore to ACTIVE
    if (currentStatus === "DISABLED") {
      nextStatus = "ACTIVE";
    }
  } else {
    // Disable: only ACTIVE → DISABLED
    if (currentStatus === "ACTIVE") {
      nextStatus = "DISABLED";
    }
  }

  const updated = await prisma.mcpConnector.update({
    where: { id },
    data: { status: nextStatus },
  });

  return Response.json({
    connector: {
      id: updated.id,
      name: updated.name,
      url: updated.url,
      hasToken: Boolean(updated.encryptedAccessToken),
      status: updated.status,
      lastError: updated.lastError,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireRequestUser(request.headers);
  const { id } = await params;

  const connector = await prisma.mcpConnector.findUnique({ where: { id } });
  if (!connector || connector.userId !== user.userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.mcpConnector.delete({ where: { id } });

  return Response.json({ ok: true });
}
