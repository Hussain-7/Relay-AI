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


/**
 * Resolve the sender's Relay AI user from a Chat SDK message.
 *
 * Google Chat HTTP endpoint webhooks provide `userId: "users/{numericId}"` but NOT email.
 * The numeric ID matches the `sub` / `provider_id` stored in Supabase's `auth.users`
 * when the user signed in via Google OAuth. We query auth.users by provider_id → get
 * the Supabase userId → look up UserProfile.
 */
async function resolveSenderUser(message: { author?: unknown; raw?: unknown }) {
  const author = message.author as Record<string, unknown> | undefined;
  console.log("[gchat-bot] resolveSenderUser — author:", JSON.stringify(author));

  // 1. Try email if directly available (rare for HTTP endpoint apps)
  if (typeof author?.email === "string" && author.email) {
    console.log("[gchat-bot] Found email in author:", author.email);
    if (!isEmailAllowed(author.email)) return null;
    return prisma.userProfile.findUnique({ where: { email: author.email.toLowerCase() } });
  }

  // 2. Match by Google numeric user ID → Supabase auth.users.provider_id
  //    author.userId comes as "users/110522809986993401130" — extract the numeric part
  const gchatUserId = author?.userId as string | undefined;
  if (gchatUserId) {
    const numericId = gchatUserId.replace("users/", "");
    console.log("[gchat-bot] Looking up by Google provider_id:", numericId);

    // Query Supabase auth.users via Prisma raw query (auth schema isn't in our Prisma models)
    const authUsers = await prisma.$queryRawUnsafe<Array<{ id: string; email: string }>>(
      `SELECT id, email FROM auth.users WHERE raw_user_meta_data->>'provider_id' = $1 LIMIT 1`,
      numericId,
    );

    if (authUsers.length > 0) {
      const authUser = authUsers[0];
      console.log("[gchat-bot] Matched auth.user by provider_id:", { id: authUser.id, email: authUser.email });
      if (!isEmailAllowed(authUser.email)) return null;
      return prisma.userProfile.findUnique({ where: { userId: authUser.id } });
    }
    console.log("[gchat-bot] No auth.user found for provider_id:", numericId);
  }

  // 3. Fall back to fullName lookup
  const fullName = author?.fullName as string | undefined;
  if (fullName) {
    console.log("[gchat-bot] Falling back to fullName lookup:", fullName);
    const user = await prisma.userProfile.findFirst({
      where: { fullName: { equals: fullName, mode: "insensitive" } },
    });
    if (user) {
      console.log("[gchat-bot] Matched user by fullName:", user.email);
      if (!isEmailAllowed(user.email)) return null;
      return user;
    }
  }

  console.log("[gchat-bot] Could not resolve sender to any Relay AI user");
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

  const user = await resolveSenderUser(message);

  if (!user) {
    console.log("[gchat-bot] User not resolved — posting signup link");
    await thread.post(
      `You need a Relay AI account to use this bot. Sign up at ${process.env.APP_URL ?? "https://relay-ai-delta.vercel.app"}`,
    );
    return;
  }
  console.log("[gchat-bot] Resolved user:", { userId: user.userId, email: user.email });

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

  const user = await resolveSenderUser(message);
  if (!user) { console.log("[gchat-bot] User not resolved — skipping"); return; }
  console.log("[gchat-bot] Resolved user:", { userId: user.userId });

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
