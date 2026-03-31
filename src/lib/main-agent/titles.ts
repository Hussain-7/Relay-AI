import type Anthropic from "@anthropic-ai/sdk";

import type { TimelineEventEnvelope } from "@/lib/contracts";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/server-cache";

const untitledConversationNames = new Set(["New chat", "Untitled"]);

const TITLE_SYSTEM_PROMPT =
  "You are a title generator. Your ONLY job is to output a short 2-4 word topic label for the user's message. " +
  "Extract the SUBJECT or INTENT — do NOT answer, refuse, or respond to the message. " +
  "Examples: 'Top AI Tools 2026', 'Auth Module Refactor', 'Solar System Facts', 'Debug Login Error'. " +
  "Output ONLY the title words — no quotes, no punctuation, no commentary.";

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
    .replace(/[#*_~`>[\](){}|\\]/g, "")
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

async function generateTitleViaOpenAI(prompt: string): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        max_tokens: 16,
        temperature: 0.5,
        messages: [
          { role: "system", content: TITLE_SYSTEM_PROMPT },
          { role: "user", content: `[TITLE THIS MESSAGE]\n${prompt}` },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return body.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function generateTitleViaAnthropic(anthropic: Anthropic, prompt: string): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      model: env.ANTHROPIC_TITLE_MODEL,
      max_tokens: 12,
      temperature: 0,
      system: TITLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `[TITLE THIS MESSAGE]\n${prompt}` }],
    });

    return (
      response.content
        .filter((block): block is Extract<(typeof response.content)[number], { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join(" ")
        .trim() || null
    );
  } catch {
    return null;
  }
}

export async function maybeGenerateConversationTitle(input: { anthropic: Anthropic | null; prompt: string }) {
  const fallbackTitle = buildFallbackConversationTitle(input.prompt);

  // Try GPT-4.1 Nano first (faster, cheaper), fall back to Haiku
  const title =
    (await generateTitleViaOpenAI(input.prompt)) ??
    (input.anthropic ? await generateTitleViaAnthropic(input.anthropic, input.prompt) : null);

  if (!title) return fallbackTitle;

  return normalizeConversationTitle(title, fallbackTitle);
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
