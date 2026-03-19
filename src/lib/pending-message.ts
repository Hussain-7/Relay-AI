import type { AttachmentDto } from "@/lib/contracts";

interface PendingMessage {
  conversationId: string;
  prompt: string;
  attachments: AttachmentDto[];
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
