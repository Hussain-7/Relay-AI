import { anthropic } from "@ai-sdk/anthropic";
import { cerebras } from "@ai-sdk/cerebras";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";

/**
 * Resolve a model string to a Vercel AI SDK LanguageModel instance.
 * Detects the provider from the model name prefix or known patterns.
 *
 * Examples:
 *   "llama3.1-8b"           → cerebras("llama3.1-8b")
 *   "gpt-4.1-nano"          → openai("gpt-4.1-nano")
 *   "gpt-4o-mini"           → openai("gpt-4o-mini")
 *   "claude-haiku-4-5-..."  → anthropic("claude-haiku-4-5-...")
 *   "claude-sonnet-4-6"     → anthropic("claude-sonnet-4-6")
 *   "gemini-2.0-flash"      → google("gemini-2.0-flash")
 */
export function resolveModel(model: string): LanguageModel {
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) {
    return openai(model);
  }
  if (model.startsWith("claude-")) {
    return anthropic(model);
  }
  if (model.startsWith("gemini-")) {
    return google(model);
  }
  // Cerebras models: llama*, qwen*
  if (model.startsWith("llama") || model.startsWith("qwen")) {
    return cerebras(model);
  }
  // Default to openai for unknown models
  return openai(model);
}

/**
 * Simple text completion using any supported model.
 * Auto-resolves the provider from the model name.
 */
export async function generateCompletion(options: {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: resolveModel(options.model),
      system: options.system,
      prompt: options.prompt,
      maxOutputTokens: options.maxTokens ?? 100,
      temperature: options.temperature ?? 0,
      abortSignal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    return text.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Try multiple models in order, returning the first successful result.
 * Useful for fallback chains (e.g., Cerebras → OpenAI → Anthropic).
 */
export async function generateCompletionWithFallback(options: {
  models: string[];
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string | null> {
  for (const model of options.models) {
    const result = await generateCompletion({ ...options, model });
    if (result) return result;
  }
  return null;
}
