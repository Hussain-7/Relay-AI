import type Anthropic from "@anthropic-ai/sdk";

import { env } from "@/lib/env";

const ERROR_RECOVERY_SYSTEM =
  "You are a helpful AI assistant. The main AI model encountered an error while processing the user's request. " +
  "Generate a brief, friendly response acknowledging the issue and suggesting the user try again. " +
  "Do NOT expose raw error details, API internals, or technical jargon. Keep it to 1-2 sentences. Plain text only.";

const STATIC_FALLBACK = "I ran into an issue processing your request. Please try again in a moment.";

function buildErrorPrompt(userPrompt: string, errorMessage: string) {
  return `User asked: "${userPrompt.slice(0, 200)}"\n\nError encountered: ${errorMessage.slice(0, 300)}\n\nGenerate a user-friendly response.`;
}

async function generateViaOpenAI(
  userPrompt: string,
  errorMessage: string,
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: ERROR_RECOVERY_SYSTEM },
        { role: "user", content: buildErrorPrompt(userPrompt, errorMessage) },
      ],
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) return null;

  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return body.choices?.[0]?.message?.content?.trim() || null;
}

async function generateViaAnthropic(
  anthropic: Anthropic,
  userPrompt: string,
  errorMessage: string,
): Promise<string | null> {
  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_TITLE_MODEL,
    max_tokens: 200,
    temperature: 0,
    system: ERROR_RECOVERY_SYSTEM,
    messages: [
      { role: "user", content: buildErrorPrompt(userPrompt, errorMessage) },
    ],
  });

  const text = response.content
    .filter((b): b is Extract<(typeof response.content)[number], { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return text || null;
}

/**
 * Generate a user-friendly error response when the main agent fails.
 * Tries OpenAI gpt-4o-mini first (different provider, unaffected by Anthropic issues),
 * falls back to Anthropic Haiku, then returns a static message.
 */
export async function generateErrorResponse(
  anthropic: Anthropic | null,
  userPrompt: string,
  errorMessage: string,
): Promise<string> {
  // Try OpenAI first (different provider = likely unaffected by Anthropic outage/rate limit)
  try {
    const openaiResult = await generateViaOpenAI(userPrompt, errorMessage);
    if (openaiResult) return openaiResult;
  } catch { /* fall through */ }

  // Fallback to Anthropic Haiku
  if (anthropic) {
    try {
      const anthropicResult = await generateViaAnthropic(anthropic, userPrompt, errorMessage);
      if (anthropicResult) return anthropicResult;
    } catch { /* fall through */ }
  }

  return STATIC_FALLBACK;
}
