import { getBot } from "@/lib/bot";

export async function POST(request: Request) {
  return getBot().webhooks.gchat(request);
}
