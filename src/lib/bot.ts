import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createRedisState } from "@chat-adapter/state-redis";

import { streamMainAgentRun } from "@/lib/main-agent/runtime";
import { createConversationForUser } from "@/lib/conversations";
import { isEmailAllowed } from "@/lib/allowed-emails";
import { prisma } from "@/lib/prisma";

// ─── Bot instance (cached globally — survives warm starts) ───────────────────

declare global {
  var __relayAiBot__: Chat | undefined;
}

// Fallback user ID if user resolution fails
const FALLBACK_USER_ID = process.env.GCHAT_DEFAULT_USER_ID ?? "35e4ced0-e974-4a44-8c2c-0f1ac93d786f";

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

/**
 * Resolve the sender's Relay AI user from a Chat SDK message.
 * Google Chat HTTP endpoints provide fullName but not email.
 * Falls back to FALLBACK_USER_ID if resolution fails.
 */
async function resolveSenderUserId(message: { author?: unknown }): Promise<string> {
  try {
    const author = message.author as Record<string, unknown> | undefined;
    console.log("[gchat-bot] resolving user from author:", JSON.stringify(author));

    // 1. Try email first (if available)
    if (typeof author?.email === "string" && author.email) {
      console.log("[gchat-bot] found email:", author.email);
      if (!isEmailAllowed(author.email)) return FALLBACK_USER_ID;
      const user = await prisma.userProfile.findUnique({ where: { email: author.email.toLowerCase() } });
      if (user) return user.userId;
    }

    // 2. Match by Google user ID → auth.users.provider_id (exact match)
    //    Google Chat sends "users/110522809986993401130" which matches the Google OAuth sub/provider_id
    const gchatUserId = author?.userId as string | undefined;
    if (gchatUserId) {
      const numericId = gchatUserId.replace("users/", "");
      console.log("[gchat-bot] looking up by provider_id:", numericId);

      const authUsers = await prisma.$queryRawUnsafe<Array<{ id: string; email: string }>>(
        `SELECT id, email FROM auth.users WHERE raw_user_meta_data->>'provider_id' = $1 LIMIT 1`,
        numericId,
      );

      if (authUsers.length > 0) {
        const authUser = authUsers[0];
        console.log("[gchat-bot] matched by provider_id:", authUser.email);
        if (!isEmailAllowed(authUser.email)) return FALLBACK_USER_ID;
        const profile = await prisma.userProfile.findUnique({ where: { userId: authUser.id } });
        if (profile) return profile.userId;
      }
      console.log("[gchat-bot] no match for provider_id:", numericId);
    }

    // 3. Fallback: match by fullName
    const fullName = author?.fullName as string | undefined;
    if (fullName) {
      console.log("[gchat-bot] falling back to fullName:", fullName);
      const user = await prisma.userProfile.findFirst({
        where: { fullName: { equals: fullName, mode: "insensitive" } },
      });
      if (user && isEmailAllowed(user.email)) return user.userId;
    }
  } catch (err) {
    console.warn("[gchat-bot] User resolution failed, using fallback:", (err as Error).message?.slice(0, 100));
  }

  console.log("[gchat-bot] using fallback user ID");
  return FALLBACK_USER_ID;
}

/**
 * Convert standard Markdown to Google Chat's supported formatting.
 * Google Chat supports: *bold*, _italic_, ~strikethrough~, `code`, ```code blocks```
 * Does NOT support: headings, tables, images, blockquotes, links
 */
function markdownToGChat(md: string): string {
  return md
    // Convert markdown images ![alt](url) → "alt: url"
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1: $2")
    // Convert markdown links [text](url) → "text (url)"
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    // Convert **bold** → *bold* (Google Chat uses single asterisk)
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    // Convert ### heading → *heading* (bold, no heading support)
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // Convert > blockquote → "| quote" (visual indent)
    .replace(/^>\s?(.*)$/gm, "│ $1")
    // Strip markdown table separators |---|---|
    .replace(/^\|[-:| ]+\|$/gm, "")
    // Convert table rows | a | b | → "a | b"
    .replace(/^\|\s*(.+?)\s*\|$/gm, (_, content: string) =>
      content.replace(/\s*\|\s*/g, " | ").trim()
    )
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, "\n\n");
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
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return markdownToGChat(finalText || "I wasn't able to generate a response.");
}

// ─── Event handlers ──────────────────────────────────────────────────────────

function registerHandlers(bot: Chat) {

bot.onNewMention(async (thread, message) => {
  console.log("[gchat-bot] onNewMention:", message.text?.slice(0, 80), "isDM:", thread.isDM);
  console.log("[gchat-bot] author:", JSON.stringify(message.author));

  const userId = await resolveSenderUserId(message);
  console.log("[gchat-bot] resolved userId:", userId);

  const conversation = await createConversationForUser({ userId });
  console.log("[gchat-bot] conversation:", conversation.id);

  await thread.subscribe();
  await thread.setState({ conversationId: conversation.id, userId });

  const placeholder = await thread.post("Thinking...");
  console.log("[gchat-bot] placeholder posted, running agent...");

  try {
    const text = await runAgentAndGetFinalText(conversation.id, userId, message.text);
    console.log("[gchat-bot] agent done, response length:", text.length);
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

  const userId = state.userId ?? await resolveSenderUserId(message);
  const placeholder = await thread.post("Thinking...");

  try {
    const text = await runAgentAndGetFinalText(state.conversationId, userId, message.text);
    await placeholder.edit(text);
  } catch (err) {
    console.error("[gchat-bot] Error:", err);
    await placeholder.edit("Sorry, something went wrong.");
  }
});

// Handle DMs explicitly — same logic as onNewMention but logs differently for debugging
bot.onDirectMessage(async (thread, message) => {
  console.log("[gchat-bot] onDirectMessage:", message.text?.slice(0, 80));
  console.log("[gchat-bot] DM author:", JSON.stringify(message.author));

  const userId = await resolveSenderUserId(message);
  console.log("[gchat-bot] DM resolved userId:", userId);

  const conversation = await createConversationForUser({ userId });
  await thread.subscribe();
  await thread.setState({ conversationId: conversation.id, userId });

  const placeholder = await thread.post("Thinking...");

  try {
    const text = await runAgentAndGetFinalText(conversation.id, userId, message.text);
    await placeholder.edit(text);
  } catch (err) {
    console.error("[gchat-bot] DM Error:", err);
    await placeholder.edit("Sorry, something went wrong.");
  }
});

} // end registerHandlers
