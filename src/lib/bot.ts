import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createRedisState } from "@chat-adapter/state-redis";

import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { createConversationForUser } from "@/lib/conversations";
import { prisma } from "@/lib/prisma";

// ─── Bot instance (cached globally — survives warm starts) ───────────────────

declare global {
  var __relayAiBot__: Chat | undefined;
}

// Default user for all gchat requests (first user in the system)
const DEFAULT_USER_ID = process.env.GCHAT_DEFAULT_USER_ID;

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

async function getDefaultUserId(): Promise<string> {
  if (DEFAULT_USER_ID) return DEFAULT_USER_ID;
  console.log('DEFAULT_USER_ID not found, finding first user');
  // Fall back to first user in the DB
  const user = await prisma.userProfile.findFirst({ orderBy: { createdAt: "asc" } });
  console.log('user found', user);
  if (!user) throw new Error("No users in the system");
  return user.userId;
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
  const userId = await getDefaultUserId();
  console.log('userId', userId);
  const conversation = await createConversationForUser({ userId });
  console.log('conversation', conversation);
  await thread.subscribe();
  console.log('thread subscribed');
  await thread.setState({ conversationId: conversation.id, userId });
  console.log('state set');
  const placeholder = await thread.post("Thinking...");
  console.log('placeholder posted');
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

  const userId = state.userId ?? await getDefaultUserId();
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
