import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat-workspace";
import { generateGreeting } from "@/lib/greeting";
import { getPageUser } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "New chat",
};

export default async function NewChatPage() {
  const user = await getPageUser();
  const greeting = user ? await generateGreeting(user.userId, user.fullName?.split(" ")[0]) : undefined;

  return <ChatWorkspace greeting={greeting} />;
}
