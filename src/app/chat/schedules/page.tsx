import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat-workspace";

export const metadata: Metadata = {
  title: "Schedules — Relay AI",
};

export default function SchedulesPage() {
  return <ChatWorkspace view="schedules" />;
}
