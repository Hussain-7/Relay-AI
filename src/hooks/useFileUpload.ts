import { useRef, useState } from "react";
import type { PendingFile } from "@/components/chat/attachment-chip";
import { api } from "@/lib/api-client";
import type { AttachmentDto, ConversationDetailDto } from "@/lib/contracts";

interface UseFileUploadParams {
  activeConversationId: string | null;
  activeConversation: ConversationDetailDto | undefined;
  previewUrlMapRef: React.RefObject<Map<string, string>>;
  setComposerAttachments: React.Dispatch<React.SetStateAction<AttachmentDto[]>>;
}

export function useFileUpload({
  activeConversationId,
  activeConversation,
  previewUrlMapRef,
  setComposerAttachments,
}: UseFileUploadParams) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    // Upload immediately — conversationId is optional in the API
    const convId = activeConversation?.id ?? activeConversationId ?? undefined;
    void uploadFiles(files, convId);
  }

  async function uploadFiles(files: FileList | File[], convId?: string) {
    const fileArray = Array.from(files);
    const newPending: PendingFile[] = fileArray.map((file) => ({
      clientId: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      status: "uploading" as const,
    }));
    setPendingFiles((prev) => [...prev, ...newPending]);

    const results = await Promise.allSettled(
      newPending.map(async (pf) => {
        const formData = new FormData();
        if (convId) formData.append("conversationId", convId);
        formData.append("file", pf.file);
        const body = await api.upload<{ attachment: AttachmentDto }>("/api/uploads", formData);
        return { clientId: pf.clientId, attachment: body.attachment };
      }),
    );

    const successAttachments: AttachmentDto[] = [];
    const updatedStatuses = new Map<string, Partial<PendingFile>>();

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { clientId, attachment } = result.value;
        successAttachments.push(attachment);
        updatedStatuses.set(clientId, { status: "done", attachment });
        const pf = newPending.find((p) => p.clientId === clientId);
        // Use storageUrl (persistent CDN) for preview instead of blob URL
        if (attachment.storageUrl) {
          previewUrlMapRef.current.set(attachment.id, attachment.storageUrl);
          if (pf?.previewUrl) URL.revokeObjectURL(pf.previewUrl);
        } else if (pf?.previewUrl) {
          previewUrlMapRef.current.set(attachment.id, pf.previewUrl);
        }
      } else {
        const idx = results.indexOf(result);
        const pf = newPending[idx];
        if (pf) {
          updatedStatuses.set(pf.clientId, {
            status: "error",
            error: result.reason instanceof Error ? result.reason.message : "Upload failed.",
          });
        }
      }
    }

    setPendingFiles((prev) =>
      prev
        .map((pf) => {
          const update = updatedStatuses.get(pf.clientId);
          return update ? { ...pf, ...update } : pf;
        })
        .filter((pf) => pf.status !== "done"),
    );

    if (successAttachments.length > 0) {
      setComposerAttachments((existing) => {
        const existingIds = new Set(existing.map((a) => a.id));
        const newOnes = successAttachments.filter((a) => !existingIds.has(a.id));
        return [...existing, ...newOnes];
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";

    return successAttachments;
  }

  return {
    pendingFiles,
    setPendingFiles,
    isDraggingOver,
    setIsDraggingOver,
    fileInputRef,
    handleUpload,
    uploadFiles,
  };
}
