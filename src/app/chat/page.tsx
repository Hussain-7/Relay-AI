import { ChatWorkspace } from "@/components/chat-workspace";
import { requireOnboardedAppUser } from "@/lib/app-state";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { user } = await requireOnboardedAppUser();

  return (
    <ChatWorkspace
      user={{
        email: user.email,
        fullName: user.fullName,
      }}
    />
  );
}
