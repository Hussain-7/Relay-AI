import { generateCompletionWithFallback } from "@/lib/ai";

const ERROR_RECOVERY_SYSTEM =
  "You are a helpful AI assistant. The main AI model encountered an error while processing the user's request. " +
  "Generate a brief, friendly response acknowledging the issue and suggesting the user try again. " +
  "Do NOT expose raw error details, API internals, or technical jargon. Keep it to 1-2 sentences. Plain text only.";

const STATIC_FALLBACK = "I ran into an issue processing your request. Please try again in a moment.";

// Avoid Anthropic here since the error likely originated from their API.
// Cerebras (different infra) → OpenAI (different provider) → static fallback.
const ERROR_MODELS = ["llama3.1-8b", "gpt-4o-mini"];

/**
 * Generate a user-friendly error response when the main agent fails.
 * Uses fastest available non-Anthropic model to avoid cascading failures.
 */
export async function generateErrorResponse(
  _anthropic: unknown,
  userPrompt: string,
  errorMessage: string,
): Promise<string> {
  const prompt = `User asked: "${userPrompt.slice(0, 200)}"\n\nError encountered: ${errorMessage.slice(0, 300)}\n\nGenerate a user-friendly response.`;

  const result = await generateCompletionWithFallback({
    models: ERROR_MODELS,
    system: ERROR_RECOVERY_SYSTEM,
    prompt,
    maxTokens: 200,
    temperature: 0,
    timeoutMs: 8_000,
  });

  return result ?? STATIC_FALLBACK;
}
