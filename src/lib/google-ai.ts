import type { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

let _client: GoogleGenAI | null = null;

export async function getGoogleAiClient(): Promise<GoogleGenAI> {
  if (!_client) {
    if (!env.GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY is required.");
    const { GoogleGenAI: GenAI } = await import("@google/genai");
    _client = new GenAI({ apiKey: env.GOOGLE_AI_API_KEY });
  }
  return _client;
}
