import { useEffect, useRef, useState } from "react";
import { resizeComposer } from "@/lib/chat-utils";
import type { AttachmentDto } from "@/lib/contracts";

export function useComposerState() {
  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<AttachmentDto[]>([]);
  const [stagedRepoBinding, setStagedRepoBinding] = useState<{ id: string; repoFullName: string } | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeComposer(composerInputRef.current);
  }, [composerValue]);

  return {
    composerValue,
    setComposerValue,
    composerAttachments,
    setComposerAttachments,
    stagedRepoBinding,
    setStagedRepoBinding,
    composerInputRef,
  };
}
