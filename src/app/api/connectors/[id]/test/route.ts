import { NextRequest, NextResponse } from "next/server";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveAuthContext(request);
    const { id } = await context.params;

    const connector = await prisma.connectorConfig.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
    });

    if (!connector) {
      return NextResponse.json(
        { error: "Connector not found" },
        { status: 404 },
      );
    }

    if (!connector.baseUrl) {
      return NextResponse.json({
        ok: true,
        connectorId: connector.id,
        note: "No baseUrl configured",
      });
    }

    try {
      const response = await fetch(connector.baseUrl, { method: "HEAD" });
      return NextResponse.json({
        ok: response.ok,
        status: response.status,
        connectorId: connector.id,
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          connectorId: connector.id,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 502 },
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
