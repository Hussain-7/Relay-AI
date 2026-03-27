import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat-workspace";
import { prisma } from "@/lib/prisma";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const conv = await prisma.conversation.findUnique({
    where: { id },
    select: { title: true },
  });
  return {
    title: conv?.title ?? "Chat",
  };
}

export default async function ChatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatWorkspace conversationId={id} />;
}
