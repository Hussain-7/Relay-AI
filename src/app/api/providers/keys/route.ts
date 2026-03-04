import { ProviderId } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthContext } from "@/lib/auth-context";
import { encryptSecret } from "@/lib/crypto";
import { errorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  userId: z.string().optional(),
  provider: z.enum(["openai", "anthropic"]),
  apiKey: z.string().min(1),
});

async function validateOpenAIKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAI key validation failed (${response.status})`);
  }
}

async function validateAnthropicKey(apiKey: string): Promise<void> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    throw new Error(`Anthropic key validation failed (${response.status})`);
  }
}

async function validateKey(
  provider: "openai" | "anthropic",
  apiKey: string,
): Promise<void> {
  if (provider === "openai") {
    await validateOpenAIKey(apiKey);
    return;
  }

  await validateAnthropicKey(apiKey);
}

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.parse(await request.json());
    const auth = await resolveAuthContext(request, body.userId);
    const provider =
      body.provider === "openai" ? ProviderId.OPENAI : ProviderId.ANTHROPIC;

    await validateKey(body.provider, body.apiKey);

    const encrypted = encryptSecret(body.apiKey);
    const encryptedKeyBlob = JSON.stringify(encrypted);

    const saved = await prisma.providerCredential.upsert({
      where: {
        userId_provider: {
          userId: auth.userId,
          provider,
        },
      },
      update: {
        encryptedKeyBlob,
        status: "active",
        validatedAt: new Date(),
      },
      create: {
        userId: auth.userId,
        provider,
        encryptedKeyBlob,
        status: "active",
        validatedAt: new Date(),
      },
    });

    return NextResponse.json({
      id: saved.id,
      userId: saved.userId,
      provider: saved.provider,
      status: saved.status,
      validatedAt: saved.validatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
