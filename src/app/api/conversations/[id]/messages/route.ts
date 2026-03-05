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
    const limit = Math.min(
      200,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "100")),
    );
    const offset = Math.max(
      0,
      Number(request.nextUrl.searchParams.get("offset") ?? "0"),
    );

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
      select: { id: true, title: true, defaultMode: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: id,
      },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: limit,
    });

    return NextResponse.json({
      conversation,
      messages,
      limit,
      offset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
