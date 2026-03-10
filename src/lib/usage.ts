/**
 * Token pricing per million tokens (USD).
 * Source: https://www.anthropic.com/pricing
 */
const MODEL_PRICING: Record<string, {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}> = {
  "claude-opus-4-6": {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    cacheRead: 0.3,
  },
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
};

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function calculateCostUsd(usage: TokenUsage): number {
  const pricing = MODEL_PRICING[usage.model];

  if (!pricing) {
    // Unknown model — use Sonnet pricing as default
    const fallback = MODEL_PRICING["claude-sonnet-4-6"]!;
    return (
      (usage.inputTokens / 1_000_000) * fallback.input +
      (usage.outputTokens / 1_000_000) * fallback.output +
      (usage.cacheReadTokens / 1_000_000) * fallback.cacheRead +
      (usage.cacheWriteTokens / 1_000_000) * fallback.cacheWrite5m
    );
  }

  return (
    (usage.inputTokens / 1_000_000) * pricing.input +
    (usage.outputTokens / 1_000_000) * pricing.output +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite5m
  );
}
