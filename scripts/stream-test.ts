/**
 * Bare-bones streaming test using the same Anthropic toolRunner setup as the main agent.
 * Logs text deltas to the console in real-time so you can compare raw API streaming speed
 * against the frontend rendering speed.
 *
 * Usage:
 *   npx tsx scripts/stream-test.ts
 *   npx tsx scripts/stream-test.ts "Your custom prompt here"
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";

// Load .env manually (no dotenv dependency needed)
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
} catch { /* no .env file */ }

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MAIN_MODEL ?? "claude-sonnet-4-6";

if (!API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

const prompt = process.argv[2] ?? "Explain how a web server handles an HTTP request in 3 short paragraphs.";

async function main() {
  const client = new Anthropic({ apiKey: API_KEY });

  console.log(`\n--- Stream test ---`);
  console.log(`Model:  ${MODEL}`);
  console.log(`Prompt: ${prompt}`);
  console.log(`---\n`);

  const startTime = performance.now();
  let firstTokenTime: number | null = null;
  let totalTokens = 0;
  let textChunks = 0;

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4096,
    stream: true,
    betas: ["compact-2026-01-12"],
    thinking: { type: "adaptive" as const },
    system: [
      {
        type: "text" as const,
        text: "You are a helpful assistant. Be concise and direct.",
      },
    ],
    messages: [
      { role: "user", content: prompt },
    ],
    tools: [],
  } as Parameters<typeof client.beta.messages.toolRunner>[0]);

  for await (const iteration of runner) {
    for await (const event of iteration as AsyncIterable<BetaRawMessageStreamEvent>) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as unknown as Record<string, unknown>;

        // Text delta — the main thing we care about
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
          }
          process.stdout.write(delta.text);
          textChunks++;
        }

        // Thinking delta — show in gray
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          if (firstTokenTime === null) {
            firstTokenTime = performance.now();
          }
          process.stdout.write(`\x1b[90m${delta.thinking}\x1b[0m`);
        }
      }

      // Track usage from message_start
      if (event.type === "message_start") {
        const msg = (event as unknown as Record<string, unknown>).message as Record<string, unknown> | undefined;
        if (msg?.usage) {
          const u = msg.usage as Record<string, number>;
          totalTokens = u.input_tokens ?? 0;
        }
      }

      // Track output tokens from message_delta
      if (event.type === "message_delta") {
        const u = (event as unknown as Record<string, unknown>).usage as Record<string, number> | undefined;
        if (u?.output_tokens) {
          totalTokens += u.output_tokens;
        }
      }
    }
  }

  const endTime = performance.now();
  const totalMs = endTime - startTime;
  const ttftMs = firstTokenTime ? firstTokenTime - startTime : null;

  console.log(`\n\n--- Stats ---`);
  console.log(`Total time:         ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`Time to first token: ${ttftMs ? `${(ttftMs / 1000).toFixed(2)}s` : "N/A"}`);
  console.log(`Text chunks:        ${textChunks}`);
  console.log(`Total tokens:       ${totalTokens}`);
  if (textChunks > 0 && ttftMs) {
    const streamingMs = endTime - (startTime + ttftMs);
    console.log(`Streaming speed:    ${(textChunks / (streamingMs / 1000)).toFixed(0)} chunks/s`);
  }
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
