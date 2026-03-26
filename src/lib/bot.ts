import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createRedisState } from "@chat-adapter/state-redis";

import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { createConversationForUser } from "@/lib/conversations";
import { isEmailAllowed } from "@/lib/allowed-emails";
import { prisma } from "@/lib/prisma";

// ─── Bot instance (lazy — avoids initialization during build) ────────────────

let _bot: Chat | null = null;

export function getBot(): Chat {
  if (!_bot) {
    const credsBase64 = process.env.GOOGLE_CHAT_CREDENTIALS_BASE64;
    const creds = credsBase64
      ? JSON.parse(Buffer.from(credsBase64, "base64").toString("utf-8")) as { client_email: string; private_key: string; project_id?: string }
      : undefined;

    const gchatConfig = creds ? { credentials: creds } : undefined;

    _bot = new Chat({
      userName: "relay-ai",
      adapters: {
        gchat: createGoogleChatAdapter(gchatConfig),
      },
      state: createRedisState({
        url: process.env.CHAT_SDK_REDIS_URL,
      }),
      streamingUpdateIntervalMs: 1000,
      fallbackStreamingPlaceholderText: null, // We post our own placeholder
    });
    registerHandlers(_bot);
  }
  return _bot;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the sender's Relay AI user from a Chat SDK message.
 * Uses fullName match (Google Chat HTTP endpoints don't provide email).
 */
async function resolveSenderUser(message: { author?: unknown }) {
  const author = message.author as Record<string, unknown> | undefined;

  // 1. Try email if available
  if (typeof author?.email === "string" && author.email) {
    if (!isEmailAllowed(author.email)) return null;
    return prisma.userProfile.findUnique({ where: { email: author.email.toLowerCase() } });
  }

  // 2. Match by fullName (fast, no cross-schema query)
  const fullName = author?.fullName as string | undefined;
  if (fullName) {
    const user = await prisma.userProfile.findFirst({
      where: { fullName: { equals: fullName, mode: "insensitive" } },
    });
    if (user && isEmailAllowed(user.email)) return user;
  }

  return null;
}

/**
 * Consume the SSE stream from streamMainAgentRun and extract the final response text.
 */
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
        } catch { /* skip malformed */ }
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
  console.log("[gchat-bot] onNewMention", { text: message.text?.slice(0, 80) });

  const user = await resolveSenderUser(message);
  if (!user) {
    await thread.post(
      `You need a Relay AI account to use this bot. Sign up at ${process.env.APP_URL ?? "https://relay-ai-delta.vercel.app"}`,
    );
    return;
  }

  await thread.subscribe();

  // Create conversation and store mapping
  const conversation = await createConversationForUser({ userId: user.userId });
  await thread.setState({ conversationId: conversation.id });

  // Post placeholder immediately, then edit with the real response
  const placeholder = await thread.post("Thinking...");
  console.log("[gchat-bot] Placeholder posted, running agent...");

  try {
    const text = await runAgentAndGetFinalText(conversation.id, user.userId, message.text);
    console.log("[gchat-bot] Agent done, editing placeholder");
    await placeholder.edit(text);
  } catch (err) {
    console.error("[gchat-bot] Agent error:", err);
    await placeholder.edit("Sorry, something went wrong processing your request.");
  }
});

bot.onSubscribedMessage(async (thread, message) => {
  console.log("[gchat-bot] onSubscribedMessage", { text: message.text?.slice(0, 80) });

  const user = await resolveSenderUser(message);
  if (!user) return;

  const state = await thread.state as { conversationId?: string } | null;
  if (!state?.conversationId) return;

  const placeholder = await thread.post("Thinking...");

  try {
    const text = await runAgentAndGetFinalText(state.conversationId, user.userId, message.text);
    await placeholder.edit(text);
  } catch (err) {
    console.error("[gchat-bot] Agent error:", err);
    await placeholder.edit("Sorry, something went wrong processing your request.");
  }
});

} // end registerHandlers
