import { generateCompletionWithFallback } from "@/lib/ai";
import { requireRequestUser } from "@/lib/server-auth";
import { getCached } from "@/lib/server-cache";

const GREETING_MODELS = ["llama3.1-8b", "gpt-4.1-nano", "claude-haiku-4-5-20251001"];

const STATIC_FALLBACKS = [
  "What shall we work on?",
  "How can I help today?",
  "What's on your mind?",
  "Ready when you are",
  "Let's get started",
];

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const firstName = user.fullName?.split(" ")[0] ?? "";

    const now = new Date();
    const hour = now.getHours();
    const day = now.toLocaleDateString("en-US", { weekday: "long" });
    const month = now.toLocaleDateString("en-US", { month: "long" });
    const date = now.getDate();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

    // Cache per user per hour
    const cacheKey = `greeting:${user.userId}:${hour}`;
    const greeting = await getCached(cacheKey, 3600, async () => {
      const ai = await generateCompletionWithFallback({
        models: GREETING_MODELS,
        system: `You generate a single short greeting for an AI workspace app. Shown as a large heading when the user opens a new chat. Be creative, contextual to the time of day and day of week. Never use emojis. Never use quotes. Maximum 6 words. Address the user by first name if provided. Examples: "Good morning, Alex", "What's the plan, Sam?", "Happy Friday, let's go", "Evening, Hussain", "Ready to build?", "How can I help, Aria?"`,
        prompt: `Greeting for ${firstName || "a user"}. It's ${timeOfDay} on ${day}, ${month} ${date}. Output only the greeting:`,
        maxTokens: 30,
        temperature: 0.9,
        timeoutMs: 3000,
      });

      // Always return something — use static fallback if AI fails
      if (ai) return ai;
      const fallback = STATIC_FALLBACKS[Math.floor(Math.random() * STATIC_FALLBACKS.length)];
      return firstName ? `${fallback}, ${firstName}` : fallback;
    });

    return Response.json({ greeting });
  } catch {
    const fallback = STATIC_FALLBACKS[Math.floor(Math.random() * STATIC_FALLBACKS.length)];
    return Response.json({ greeting: fallback });
  }
}
