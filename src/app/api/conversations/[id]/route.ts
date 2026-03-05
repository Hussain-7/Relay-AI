import { RunMode } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const updateConversationSchema = z.object({
  userId: z.string().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  defaultMode: z.enum(["chat", "agent", "coding"]).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function mapRunMode(mode?: "chat" | "agent" | "coding"): RunMode | undefined {
  if (!mode) return undefined;
  if (mode === "agent") return RunMode.AGENT;
  if (mode === "coding") return RunMode.CODING;
  return RunMode.CHAT;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const body = updateConversationSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const { id } = await context.params;

    const existing = await prisma.conversation.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.defaultMode
          ? { defaultMode: mapRunMode(body.defaultMode) }
          : {}),
      },
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await resolveAuthContext(request);
    const { id } = await context.params;

    const existing = await prisma.conversation.findFirst({
      where: {
        id,
        userId: auth.userId,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    await prisma.conversation.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
