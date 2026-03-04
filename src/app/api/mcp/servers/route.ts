import { ServerType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const createMcpServerSchema = z.object({
  userId: z.string().optional(),
  serverType: z.enum(["remote", "local"]),
  config: z.record(z.any()).default({}),
  status: z.string().default("active"),
});

function mapServerType(serverType: "remote" | "local"): ServerType {
  return serverType === "remote" ? ServerType.REMOTE : ServerType.LOCAL;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);

    const servers = await prisma.mCPServer.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ servers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createMcpServerSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);

    const server = await prisma.mCPServer.create({
      data: {
        userId: auth.userId,
        serverType: mapServerType(body.serverType),
        configJson: body.config,
        status: body.status,
      },
    });

    return NextResponse.json({ server }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
