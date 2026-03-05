import { ChatWorkspace } from "@/components/chat-workspace";
import { requireOnboardedAppUser } from "@/lib/app-state";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export const dynamic = "force-dynamic";

export default async function ConversationChatPage(context: RouteContext) {
  const { user } = await requireOnboardedAppUser();
  const { conversationId } = await context.params;

  return (
    <ChatWorkspace
      user={{
        email: user.email,
        fullName: user.fullName,
      }}
      initialConversationId={conversationId}
    />
  );
}
