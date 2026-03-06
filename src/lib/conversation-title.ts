import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { ProviderId } from "@prisma/client";
import { generateText } from "ai";
import { getProviderCredential } from "@/lib/provider-credentials";

const MAX_TITLE_LENGTH = 80;

// Cheap/fast-first models for lightweight tasks such as naming.
const OPENAI_TITLE_MODELS = [
  "gpt-5.2-nano",
  "gpt-5.2-mini",
  "gpt-5-nano",
  "gpt-5-mini",
];

const ANTHROPIC_TITLE_MODELS = [
  "claude-haiku-4-5",
  "claude-3-5-haiku-latest",
];

export function deriveTitleFromMessage(message: string): string {
  const compact = message.trim().replace(/\s+/g, " ");
  return compact.length <= MAX_TITLE_LENGTH
    ? compact
    : `${compact.slice(0, MAX_TITLE_LENGTH - 3)}...`;
}

export function shouldBackfillConversationTitle(
  title: string,
  messageCount: number,
): boolean {
  if (messageCount > 0) {
    return false;
  }

  return /^new chat$/i.test(title.trim());
}

function cleanGeneratedTitle(raw: string): string {
  const compact = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "");

  if (!compact) {
    return "";
  }

  if (compact.length <= MAX_TITLE_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, MAX_TITLE_LENGTH - 3)}...`;
}

async function tryGenerateWithModels(params: {
  modelIds: string[];
  invoke: (modelId: string) => Promise<string>;
}): Promise<string | null> {
  for (const modelId of params.modelIds) {
    try {
      const title = cleanGeneratedTitle(await params.invoke(modelId));
      if (title) {
        return title;
      }
    } catch {
      // Keep fallback chain resilient to model/provider mismatches.
      continue;
    }
  }

  return null;
}

export async function generateConversationTitle(params: {
  userId: string;
  message: string;
  preferredProvider?: ProviderId;
}): Promise<string> {
  const fallback = deriveTitleFromMessage(params.message);
  if (!fallback) {
    return "New Chat";
  }

  const providerOrder = params.preferredProvider
    ? params.preferredProvider === ProviderId.OPENAI
      ? [ProviderId.OPENAI, ProviderId.ANTHROPIC]
      : [ProviderId.ANTHROPIC, ProviderId.OPENAI]
    : [ProviderId.OPENAI, ProviderId.ANTHROPIC];

  const generationPrompt = `Generate a short conversation title (3-8 words) for this message. Return title only.\n\n${params.message}`;

  for (const providerId of providerOrder) {
    if (providerId === ProviderId.OPENAI) {
      const credential = await getProviderCredential(params.userId, ProviderId.OPENAI);
      if (!credential) {
        continue;
      }

      const provider = createOpenAI({ apiKey: credential.apiKey });
      const generated = await tryGenerateWithModels({
        modelIds: OPENAI_TITLE_MODELS,
        invoke: async (modelId) => {
          const result = await generateText({
            model: provider(modelId),
            system:
              "You create concise conversation titles. Output plain text only.",
            prompt: generationPrompt,
            maxOutputTokens: 24,
            temperature: 0,
          });
          return result.text;
        },
      });

      if (generated) {
        return generated;
      }

      continue;
    }

    const credential = await getProviderCredential(params.userId, ProviderId.ANTHROPIC);
    if (!credential) {
      continue;
    }

    const provider = createAnthropic({ apiKey: credential.apiKey });
    const generated = await tryGenerateWithModels({
      modelIds: ANTHROPIC_TITLE_MODELS,
      invoke: async (modelId) => {
        const result = await generateText({
          model: provider(modelId),
          system:
            "You create concise conversation titles. Output plain text only.",
          prompt: generationPrompt,
          maxOutputTokens: 24,
          temperature: 0,
        });
        return result.text;
      },
    });

    if (generated) {
      return generated;
    }
  }

  return fallback;
}
