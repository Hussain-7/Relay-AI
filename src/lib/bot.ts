import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createRedisState } from "@chat-adapter/state-redis";

import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { createConversationForUser } from "@/lib/conversations";

// ─── Bot instance (cached globally — survives warm starts) ───────────────────

declare global {
  var __relayAiBot__: Chat | undefined;
}

// Default user for all gchat requests — MUST be set, no DB fallback
// (Prisma queries hang on Vercel serverless due to cold-start connection issues)
const DEFAULT_USER_ID = process.env.GCHAT_DEFAULT_USER_ID ?? "35e4ced0-e974-4a44-8c2c-0f1ac93d786f";

export function getBot(): Chat {
  if (!globalThis.__relayAiBot__) {
    const credsBase64 = process.env.GOOGLE_CHAT_CREDENTIALS_BASE64;
    const creds = credsBase64
      ? JSON.parse(Buffer.from(credsBase64, "base64").toString("utf-8")) as { client_email: string; private_key: string }
      : undefined;

    globalThis.__relayAiBot__ = new Chat({
      userName: "relay-ai",
      adapters: {
        gchat: createGoogleChatAdapter(creds ? { credentials: creds } : undefined),
      },
      state: createRedisState({
        url: process.env.CHAT_SDK_REDIS_URL,
      }),
      streamingUpdateIntervalMs: 1000,
      fallbackStreamingPlaceholderText: null,
    });
    registerHandlers(globalThis.__relayAiBot__);
  }
  return globalThis.__relayAiBot__;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDefaultUserId(): string {
  return DEFAULT_USER_ID;
}

async function runAgentAndGetFinalText(
  conversationId: string,
  userId: string,
  prompt: string,
): Promise<string> {
  const { stream } = await streamMainAgentRun({
    conversationId,
    userId,
    prompt,
    attachmentIds: [],
    preferences: { thinking: false, effort: "medium", memory: false },
  });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let finalText = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split("\n\n");
      buffer = segments.pop() ?? "";
      for (const segment of segments) {
        const line = segment.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6)) as { type: string; payload?: { text?: string } };
          if (event.type === "assistant.message.completed" && event.payload?.text) {
            finalText = event.payload.text;
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return finalText || "I wasn't able to generate a response.";
}

// ─── Event handlers ──────────────────────────────────────────────────────────

function registerHandlers(bot: Chat) {

bot.onNewMention(async (thread, message) => {
  console.log("[gchat-bot] onNewMention:", message.text?.slice(0, 80));
  const userId = getDefaultUserId();
  console.log("[gchat-bot] userId:", userId);

  const conversation = await createConversationForUser({ userId });
  console.log("[gchat-bot] conversation created:", conversation.id);

  await thread.subscribe();
  await thread.setState({ conversationId: conversation.id, userId });

  const placeholder = await thread.post("Thinking...");
  console.log("[gchat-bot] placeholder posted, running agent...");
  try {
    const text = await runAgentAndGetFinalText(conversation.id, userId, message.text);
    await placeholder.edit(text);
  } catch (err) {
    console.error("[gchat-bot] Error:", err);
    await placeholder.edit("Sorry, something went wrong.");
  }
});

bot.onSubscribedMessage(async (thread, message) => {
  console.log("[gchat-bot] onSubscribedMessage:", message.text?.slice(0, 80));

  const state = await thread.state as { conversationId?: string; userId?: string } | null;
  if (!state?.conversationId) return;

  const userId = state.userId ?? getDefaultUserId();
  const placeholder = await thread.post("Thinking...");

  try {
    const text = await runAgentAndGetFinalText(state.conversationId, userId, message.text);
    await placeholder.edit(text);
  } catch (err) {
    console.error("[gchat-bot] Error:", err);
    await placeholder.edit("Sorry, something went wrong.");
  }
});

} // end registerHandlers
