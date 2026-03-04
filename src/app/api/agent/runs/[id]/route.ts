import { NextRequest, NextResponse } from "next/server";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveAuthContext(request);
    const { id } = await context.params;

    const run = await prisma.agentRun.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
      include: {
        approvals: {
          orderBy: { createdAt: "asc" },
        },
        conversation: {
          select: {
            id: true,
            title: true,
            defaultMode: true,
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error) {
    return errorResponse(error);
  }
}
