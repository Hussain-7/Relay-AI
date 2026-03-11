import type Anthropic from "@anthropic-ai/sdk";

import type { TimelineEventEnvelope } from "@/lib/contracts";
import { env, hasAnthropicApiKey } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/server-cache";

const untitledConversationNames = new Set(["New chat", "Untitled"]);

export function buildFallbackConversationTitle(prompt: string) {
  const compact = prompt
    .replace(/\s+/g, " ")
    .replace(/["""'`]+/g, "")
    .trim();

  if (!compact) {
    return "New chat";
  }

  return compact.length > 56 ? `${compact.slice(0, 55).trimEnd()}…` : compact;
}

export function normalizeConversationTitle(title: string, fallbackTitle: string) {
  const normalized = title
    .replace(/[#*_~`>\[\](){}|\\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.:;!?,]+$/g, "")
    .trim();

  if (!normalized) {
    return fallbackTitle;
  }

  // Cap at ~4 words
  const words = normalized.split(" ");
  const capped = words.length > 4 ? words.slice(0, 4).join(" ") : normalized;

  return capped.length > 40 ? `${capped.slice(0, 39).trimEnd()}…` : capped;
}

export async function maybeGenerateConversationTitle(input: {
  anthropic: Anthropic | null;
  prompt: string;
}) {
  const fallbackTitle = buildFallbackConversationTitle(input.prompt);

  if (!input.anthropic || !hasAnthropicApiKey()) {
    return fallbackTitle;
  }

  try {
    const response = await input.anthropic.messages.create({
      model: env.ANTHROPIC_TITLE_MODEL,
      max_tokens: 12,
      temperature: 0,
      system:
        "Generate a 2-4 word chat title from the user's first message. Plain text only — no markdown, no quotation marks, no punctuation, no commentary. Just the title words.",
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
    });

    const suggestedTitle = response.content
      .filter((block): block is Extract<(typeof response.content)[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join(" ");

    return normalizeConversationTitle(suggestedTitle, fallbackTitle);
  } catch {
    return fallbackTitle;
  }
}

export async function maybeUpdateConversationTitle(input: {
  anthropic: Anthropic | null;
  conversationId: string;
  currentTitle: string;
  prompt: string;
  emit: (
    type: TimelineEventEnvelope["type"],
    source: TimelineEventEnvelope["source"],
    payload?: Record<string, unknown> | null,
  ) => void;
}) {
  if (!untitledConversationNames.has(input.currentTitle) || !input.prompt.trim()) {
    return input.currentTitle;
  }

  const nextTitle = await maybeGenerateConversationTitle({
    anthropic: input.anthropic,
    prompt: input.prompt,
  });

  if (!nextTitle || nextTitle === input.currentTitle) {
    return input.currentTitle;
  }

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      title: nextTitle,
    },
  });

  input.emit("conversation.updated", "system", {
    title: nextTitle,
  });

  void invalidateCache(`conv:${input.conversationId}`);

  return nextTitle;
}
