import type { AttachmentDto } from "@/lib/contracts";

/** A File staged in the UI that hasn't been uploaded to the API yet. */
export interface StagedFile {
  clientId: string;
  file: File;
  previewUrl: string | null;
}

interface PendingMessage {
  conversationId: string;
  prompt: string;
  attachments: AttachmentDto[];
  /** Files that still need to be uploaded before streaming. */
  stagedFiles?: StagedFile[];
  /** Repo binding to link after conversation creation. */
  stagedRepoBindingId?: string | null;
  /** Full name (owner/repo) for immediate chip display on the destination page. */
  stagedRepoFullName?: string | null;
  isNew?: boolean;
}

let pending: PendingMessage | null = null;

export function setPendingMessage(msg: PendingMessage) {
  pending = msg;
}

export function peekPendingMessage(): PendingMessage | null {
  return pending;
}

export function consumePendingMessage(): PendingMessage | null {
  const msg = pending;
  pending = null;
  return msg;
}
