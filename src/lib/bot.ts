import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createRedisState } from "@chat-adapter/state-redis";

import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { createConversationForUser } from "@/lib/conversations";
import { isEmailAllowed } from "@/lib/allowed-emails";
import { prisma } from "@/lib/prisma";

// ─── Bot instance ────────────────────────────────────────────────────────────

export const bot = new Chat({
  userName: "relay-ai",
  adapters: {
    gchat: createGoogleChatAdapter(),
  },
  state: createRedisState({
    url: process.env.CHAT_SDK_REDIS_URL,
  }),
  streamingUpdateIntervalMs: 1000,
  fallbackStreamingPlaceholderText: "Thinking...",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a Google Chat sender email → Relay AI UserProfile. Returns null if not allowed. */
async function resolveRelayUser(email: string) {
  if (!isEmailAllowed(email)) return null;
  return prisma.userProfile.findUnique({ where: { email: email.toLowerCase() } });
}

/** Extract sender email from a Chat SDK message (Google Chat adapter). */
function getSenderEmail(message: Parameters<Parameters<typeof bot.onNewMention>[0]>[1]): string | null {
  // Chat SDK normalizes author info; fall back to raw payload
  const normalized = (message.author as { email?: string })?.email;
  if (normalized) return normalized;

  // Google Chat HTTP endpoint: sender.email in raw message payload
  const raw = message.raw as { message?: { sender?: { email?: string } } } | undefined;
  return raw?.message?.sender?.email ?? null;
}

/**
 * Consume the SSE stream from streamMainAgentRun and extract the final response text.
 * Skips all intermediate events (thinking, tool calls, deltas) — only returns the
 * completed assistant message text.
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
          const event = JSON.parse(line.slice(6)) as {
            type: string;
            payload?: { text?: string };
          };

          if (event.type === "assistant.message.completed" && event.payload?.text) {
            finalText = event.payload.text;
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return finalText || "I wasn't able to generate a response.";
}

// ─── Event handlers ──────────────────────────────────────────────────────────

bot.onNewMention(async (thread, message) => {
  const email = getSenderEmail(message);
  if (!email) {
    await thread.post("Could not identify your email address.");
    return;
  }

  const user = await resolveRelayUser(email);
  if (!user) {
    await thread.post(
      `You need a Relay AI account to use this bot. Sign up at ${process.env.APP_URL ?? "https://relay-ai-delta.vercel.app"}`,
    );
    return;
  }

  await thread.subscribe();

  // Create a new Relay AI conversation for this Google Chat thread
  const conversation = await createConversationForUser({ userId: user.userId });
  await thread.setState({ conversationId: conversation.id });

  const text = await runAgentAndGetFinalText(conversation.id, user.userId, message.text);
  await thread.post(text);
});

bot.onSubscribedMessage(async (thread, message) => {
  const email = getSenderEmail(message);
  if (!email) return;

  const user = await resolveRelayUser(email);
  if (!user) return;

  const state = await thread.state as { conversationId?: string } | null;
  if (!state?.conversationId) return;

  const text = await runAgentAndGetFinalText(state.conversationId, user.userId, message.text);
  await thread.post(text);
});
