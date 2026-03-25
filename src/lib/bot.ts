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
    // Decode base64 credentials to avoid JSON escaping issues in env vars
    const credsBase64 = process.env.GOOGLE_CHAT_CREDENTIALS_BASE64;
    const creds = credsBase64
      ? JSON.parse(Buffer.from(credsBase64, "base64").toString("utf-8")) as { client_email: string; private_key: string; project_id?: string }
      : undefined;

    const gchatConfig = creds
      ? {
          credentials: creds,
          // Skip JWT verification for now — Google Chat webhook auth
          // will be re-enabled once we confirm the correct audience format.
          // googleChatProjectNumber: process.env.GOOGLE_CHAT_PROJECT_NUMBER,
        }
      : undefined;

    _bot = new Chat({
      userName: "relay-ai",
      adapters: {
        gchat: createGoogleChatAdapter(gchatConfig),
      },
      state: createRedisState({
        url: process.env.CHAT_SDK_REDIS_URL,
      }),
      streamingUpdateIntervalMs: 1000,
      fallbackStreamingPlaceholderText: "Thinking...",
    });
    registerHandlers(_bot);
  }
  return _bot;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a Google Chat sender email → Relay AI UserProfile. Returns null if not allowed. */
async function resolveRelayUser(email: string) {
  if (!isEmailAllowed(email)) return null;
  return prisma.userProfile.findUnique({ where: { email: email.toLowerCase() } });
}

/** Extract sender email from a Chat SDK message (Google Chat adapter). */
function getSenderEmail(message: { author?: unknown; raw?: unknown; text: string }): string | null {
  // Chat SDK normalizes author info
  const author = message.author as Record<string, unknown> | undefined;
  console.log("[gchat-bot] getSenderEmail — author:", JSON.stringify(author));

  // Check author.email (Chat SDK normalized)
  if (typeof author?.email === "string" && author.email) return author.email;

  // Check author.platformId or author.id — Chat SDK may put email there
  if (typeof author?.platformId === "string" && author.platformId.includes("@")) return author.platformId;

  // Google Chat HTTP endpoint: dig through raw payload
  const raw = message.raw as Record<string, unknown> | undefined;
  if (raw) {
    console.log("[gchat-bot] getSenderEmail — raw payload:", JSON.stringify(raw).slice(0, 500));

    // Top-level user object
    const user = raw.user as Record<string, unknown> | undefined;
    if (typeof user?.email === "string") return user.email;

    // message.sender object
    const msg = raw.message as Record<string, unknown> | undefined;
    const sender = msg?.sender as Record<string, unknown> | undefined;
    if (typeof sender?.email === "string") return sender.email;

    // sender displayName as fallback — try to match against allowed emails
    // Google Chat often sends displayName but not email for HTTP endpoint apps
    const displayName = sender?.displayName as string | undefined
      ?? user?.displayName as string | undefined
      ?? author?.fullName as string | undefined;
    if (displayName) {
      console.log("[gchat-bot] No email found, trying displayName lookup:", displayName);
    }
  }

  console.log("[gchat-bot] Could not extract email from message");
  return null;
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
  console.log("[gchat-bot] Calling streamMainAgentRun", { conversationId, userId, prompt: prompt.slice(0, 100) });
  const { stream } = await streamMainAgentRun({
    conversationId,
    userId,
    prompt,
    attachmentIds: [],
    preferences: { thinking: false, effort: "medium", memory: false },
  });
  console.log("[gchat-bot] Stream created, reading events...");

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

function registerHandlers(bot: Chat) {

bot.onNewMention(async (thread, message) => {
  console.log("[gchat-bot] onNewMention fired", { threadId: thread.id, text: message.text?.slice(0, 100) });
  console.log("[gchat-bot] message.author:", JSON.stringify(message.author));
  console.log("[gchat-bot] message.raw keys:", message.raw ? Object.keys(message.raw as object) : "no raw");

  const email = getSenderEmail(message);
  console.log("[gchat-bot] Resolved email:", email);

  if (!email) {
    console.log("[gchat-bot] No email found — posting error");
    await thread.post("Could not identify your email address.");
    return;
  }

  const user = await resolveRelayUser(email);
  console.log("[gchat-bot] Resolved user:", user ? { userId: user.userId, email: user.email } : "null");

  if (!user) {
    console.log("[gchat-bot] User not found or not allowed — posting signup link");
    await thread.post(
      `You need a Relay AI account to use this bot. Sign up at ${process.env.APP_URL ?? "https://relay-ai-delta.vercel.app"}`,
    );
    return;
  }

  await thread.subscribe();
  console.log("[gchat-bot] Subscribed to thread");

  const conversation = await createConversationForUser({ userId: user.userId });
  await thread.setState({ conversationId: conversation.id });
  console.log("[gchat-bot] Created conversation:", conversation.id);

  console.log("[gchat-bot] Running agent...");
  const text = await runAgentAndGetFinalText(conversation.id, user.userId, message.text);
  console.log("[gchat-bot] Agent response:", text?.slice(0, 200));

  await thread.post(text);
  console.log("[gchat-bot] Response posted");
});

bot.onSubscribedMessage(async (thread, message) => {
  console.log("[gchat-bot] onSubscribedMessage fired", { threadId: thread.id, text: message.text?.slice(0, 100) });

  const email = getSenderEmail(message);
  console.log("[gchat-bot] Resolved email:", email);
  if (!email) { console.log("[gchat-bot] No email — skipping"); return; }

  const user = await resolveRelayUser(email);
  console.log("[gchat-bot] Resolved user:", user ? { userId: user.userId } : "null");
  if (!user) { console.log("[gchat-bot] User not allowed — skipping"); return; }

  const state = await thread.state as { conversationId?: string } | null;
  console.log("[gchat-bot] Thread state:", state);
  if (!state?.conversationId) { console.log("[gchat-bot] No conversationId in state — skipping"); return; }

  console.log("[gchat-bot] Running agent for follow-up...");
  const text = await runAgentAndGetFinalText(state.conversationId, user.userId, message.text);
  console.log("[gchat-bot] Agent response:", text?.slice(0, 200));

  await thread.post(text);
  console.log("[gchat-bot] Follow-up response posted");
});

} // end registerHandlers
