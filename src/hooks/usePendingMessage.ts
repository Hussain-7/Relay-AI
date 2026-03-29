import { useEffect, useEffectEvent } from "react";
import type { PendingFile } from "@/components/chat/attachment-chip";
import type { AttachmentDto, ConversationDetailDto } from "@/lib/contracts";
import type { StagedFile } from "@/lib/pending-message";
import { consumePendingMessage, peekPendingMessage } from "@/lib/pending-message";

interface UsePendingMessageParams {
  conversationId: string | undefined;
  activeConversationId: string | null;
  activeConversation: ConversationDetailDto | undefined;
  streamStartedForRef: React.RefObject<string | null>;
  setPendingFiles: React.Dispatch<React.SetStateAction<PendingFile[]>>;
  previewUrlMapRef: React.RefObject<Map<string, string>>;
  setStagedRepoBinding: (v: { id: string; repoFullName: string } | null) => void;
  stagedRepoBinding: { id: string; repoFullName: string } | null;
  startStream: (
    conversationId: string,
    prompt: string,
    attachments: AttachmentDto[],
    isNew: boolean,
    opts?: { stagedFiles?: StagedFile[]; stagedRepoBindingId?: string | null },
  ) => Promise<void>;
}

export function usePendingMessage({
  conversationId,
  activeConversationId,
  activeConversation,
  streamStartedForRef,
  setPendingFiles,
  previewUrlMapRef,
  setStagedRepoBinding,
  stagedRepoBinding,
  startStream,
}: UsePendingMessageParams) {
  // Reset staged state on navigation — skip if a pending message targets this
  // conversation (the sibling effect will consume pending state), or if startStream
  // already ran for this conversation (guards against React Strict Mode's second
  // effect run where the pending message was consumed but blob URLs must survive).
  useEffect(() => {
    const pendingForThis = activeConversationId && peekPendingMessage()?.conversationId === activeConversationId;
    const streamForThis = streamStartedForRef.current === activeConversationId;
    if (pendingForThis || streamForThis) return;

    setPendingFiles((prev) => {
      for (const pf of prev) {
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
      }
      return [];
    });
    for (const url of previewUrlMapRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    previewUrlMapRef.current.clear();
    setStagedRepoBinding(null);
  }, [activeConversationId, streamStartedForRef, setPendingFiles, previewUrlMapRef, setStagedRepoBinding]);

  // Clear staged repo binding once the real linked binding arrives
  useEffect(() => {
    if (activeConversation?.repoBinding && stagedRepoBinding) {
      setStagedRepoBinding(null);
    }
  }, [activeConversation?.repoBinding, stagedRepoBinding, setStagedRepoBinding]);

  // Auto-send pending message when navigating to a new chat page
  const handlePendingMessage = useEffectEvent((convId: string) => {
    const pending = consumePendingMessage();
    if (pending && pending.conversationId === convId) {
      // Restore staged repo binding so the chip shows immediately (before mutation resolves)
      if (pending.stagedRepoBindingId && pending.stagedRepoFullName) {
        setStagedRepoBinding({ id: pending.stagedRepoBindingId, repoFullName: pending.stagedRepoFullName });
      }
      void startStream(convId, pending.prompt, pending.attachments, pending.isNew ?? true, {
        stagedFiles: pending.stagedFiles,
        stagedRepoBindingId: pending.stagedRepoBindingId,
      });
    }
  });

  useEffect(() => {
    if (!conversationId) return;
    handlePendingMessage(conversationId);
  }, [conversationId]);
}
