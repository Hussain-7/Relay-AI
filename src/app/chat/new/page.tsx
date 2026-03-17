import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat-workspace";

export const metadata: Metadata = {
  title: "New chat — Relay AI",
};

export default function NewChatPage() {
  return <ChatWorkspace />;
}
