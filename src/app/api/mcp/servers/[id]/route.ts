import { ServerType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const patchMcpServerSchema = z.object({
  userId: z.string().optional(),
  serverType: z.enum(["remote", "local"]).optional(),
  config: z.record(z.any()).optional(),
  status: z.string().optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function mapServerType(serverType: "remote" | "local"): ServerType {
  return serverType === "remote" ? ServerType.REMOTE : ServerType.LOCAL;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const body = patchMcpServerSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const existing = await prisma.mCPServer.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }

    const server = await prisma.mCPServer.update({
      where: { id: existing.id },
      data: {
        ...(body.serverType
          ? { serverType: mapServerType(body.serverType) }
          : {}),
        ...(body.config ? { configJson: body.config } : {}),
        ...(body.status ? { status: body.status } : {}),
      },
    });

    return NextResponse.json({ server });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveAuthContext(request);
    const { id } = await context.params;

    const existing = await prisma.mCPServer.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "MCP server not found" },
        { status: 404 },
      );
    }

    await prisma.mCPServer.delete({
      where: { id: existing.id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
