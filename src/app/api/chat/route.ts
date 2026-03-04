import { ProviderId } from "@prisma/client";
import { streamText } from "ai";
import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveLanguageModel } from "@/lib/ai-provider";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { selectModelForUser } from "@/lib/model-selection";
import { prisma } from "@/lib/prisma";

const chatBodySchema = z.object({
  userId: z.string().optional(),
  conversationId: z.string().optional(),
  title: z.string().optional(),
  userMessage: z.string().min(1),
  provider: z.enum(["openai", "anthropic"]).optional(),
  modelId: z.string().optional(),
});

function mapProvider(
  provider?: "openai" | "anthropic",
): ProviderId | undefined {
  if (!provider) {
    return undefined;
  }
  return provider === "openai" ? ProviderId.OPENAI : ProviderId.ANTHROPIC;
}

function deriveTitle(message: string): string {
  const compact = message.trim().replace(/\s+/g, " ");
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

export async function POST(request: NextRequest) {
  try {
    const body = chatBodySchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);

    const conversation = body.conversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: body.conversationId,
            userId: auth.userId,
          },
        })
      : await prisma.conversation.create({
          data: {
            userId: auth.userId,
            title: body.title?.trim() || deriveTitle(body.userMessage),
          },
        });

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        contentJson: {
          text: body.userMessage,
        },
      },
    });

    const selectedModel = await selectModelForUser({
      userId: auth.userId,
      preferredProvider: mapProvider(body.provider),
      preferredModelId: body.modelId,
      requireTools: false,
    });

    const model = resolveLanguageModel(selectedModel);

    const stream = streamText({
      model,
      system:
        "You are Endless Dev chat assistant. Be concise, factual, and actionable. Ask clarifying questions only when needed.",
      prompt: body.userMessage,
      onFinish: async ({ text, usage }) => {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            contentJson: {
              text,
            },
            modelId: `${selectedModel.provider}:${selectedModel.modelId}`,
          },
        });

        await prisma.agentRun.create({
          data: {
            userId: auth.userId,
            conversationId: conversation.id,
            mode: "CHAT",
            executionTarget: "VERCEL",
            status: "COMPLETED",
            finalMessageJson: {
              text,
            },
            usageJson: {
              inputTokens: usage.inputTokens ?? null,
              outputTokens: usage.outputTokens ?? null,
              totalTokens: usage.totalTokens ?? null,
            },
            endedAt: new Date(),
          },
        });
      },
    });

    return stream.toTextStreamResponse({
      headers: {
        "x-conversation-id": conversation.id,
        "x-model-id": `${selectedModel.provider}:${selectedModel.modelId}`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
