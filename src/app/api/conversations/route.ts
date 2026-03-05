import { RunMode } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const createConversationSchema = z.object({
  userId: z.string().optional(),
  title: z.string().trim().min(1).max(140).optional(),
  defaultMode: z.enum(["chat", "agent", "coding"]).default("chat"),
});

function mapRunMode(mode: "chat" | "agent" | "coding"): RunMode {
  if (mode === "agent") return RunMode.AGENT;
  if (mode === "coding") return RunMode.CODING;
  return RunMode.CHAT;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);
    const search = request.nextUrl.searchParams.get("q")?.trim();
    const limit = Math.min(
      100,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "30")),
    );
    const offset = Math.max(
      0,
      Number(request.nextUrl.searchParams.get("offset") ?? "0"),
    );

    const conversations = await prisma.conversation.findMany({
      where: {
        userId: auth.userId,
        ...(search
          ? {
              title: {
                contains: search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      include: {
        messages: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            contentJson: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limit,
    });

    return NextResponse.json({
      conversations: conversations.map((item) => ({
        id: item.id,
        title: item.title,
        defaultMode: item.defaultMode,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastMessage: item.messages[0] ?? null,
      })),
      limit,
      offset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createConversationSchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);

    const conversation = await prisma.conversation.create({
      data: {
        userId: auth.userId,
        title: body.title || "New Chat",
        defaultMode: mapRunMode(body.defaultMode),
      },
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
