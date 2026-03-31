import { generateCompletionWithFallback } from "@/lib/ai";
import type { TimelineEventEnvelope } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/server-cache";

const untitledConversationNames = new Set(["New chat", "Untitled"]);

const TITLE_SYSTEM_PROMPT =
  "You are a title generator. Your ONLY job is to output a short 2-4 word topic label for the user's message. " +
  "Extract the SUBJECT or INTENT — do NOT answer, refuse, or respond to the message. " +
  "Examples: 'Top AI Tools 2026', 'Auth Module Refactor', 'Solar System Facts', 'Debug Login Error'. " +
  "Output ONLY the title words — no quotes, no punctuation, no commentary.";

// Fallback chain: Cerebras (fastest) → OpenAI Nano → Haiku
const TITLE_MODELS = ["llama3.1-8b", "gpt-4.1-nano", "claude-haiku-4-5-20251001"];

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

  const words = normalized.split(" ");
  const capped = words.length > 4 ? words.slice(0, 4).join(" ") : normalized;

  return capped.length > 40 ? `${capped.slice(0, 39).trimEnd()}…` : capped;
}

export async function maybeGenerateConversationTitle(input: { prompt: string }) {
  const fallbackTitle = buildFallbackConversationTitle(input.prompt);

  const title = await generateCompletionWithFallback({
    models: TITLE_MODELS,
    system: TITLE_SYSTEM_PROMPT,
    prompt: `[TITLE THIS MESSAGE]\n${input.prompt}`,
    maxTokens: 16,
    temperature: 0.5,
    timeoutMs: 5_000,
  });

  if (!title) return fallbackTitle;
  return normalizeConversationTitle(title, fallbackTitle);
}

export async function maybeUpdateConversationTitle(input: {
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

  const nextTitle = await maybeGenerateConversationTitle({ prompt: input.prompt });

  if (!nextTitle || nextTitle === input.currentTitle) {
    return input.currentTitle;
  }

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { title: nextTitle },
  });

  input.emit("conversation.updated", "system", { title: nextTitle });
  void invalidateCache(`conv:${input.conversationId}`);

  return nextTitle;
}
