import { bot } from "@/lib/bot";

export async function POST(request: Request) {
  return bot.webhooks.gchat(request);
}
