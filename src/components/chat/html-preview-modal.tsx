"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalBackdrop, ModalPanel } from "@/components/ui/modal";
import type { AttachmentDto } from "@/lib/contracts";

export function HtmlPreviewModal({ attachment, onClose }: { attachment: AttachmentDto; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  function handleCopyLink() {
    const url = `${window.location.origin}/preview/${attachment.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-200 flex items-center justify-center bg-[rgba(0,0,0,0.6)] backdrop-blur-sm"
    >
      <ModalPanel className="flex w-[95vw] h-[90vh] flex-col rounded-[16px] border border-[rgba(255,255,255,0.1)] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="shrink-0 rounded-[6px] bg-[rgba(212,112,73,0.15)] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[rgba(212,112,73,0.9)]">
              HTML
            </span>
            <span className="text-[0.85rem] text-[rgba(245,240,232,0.88)] truncate">{attachment.filename}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" onClick={handleCopyLink}>
              <span className="flex items-center gap-1.5">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6.5 8.5a3 3 0 0 0 4.2.4l2-2a3 3 0 0 0-4.2-4.2L7.3 3.9" />
                  <path d="M9.5 7.5a3 3 0 0 0-4.2-.4l-2 2a3 3 0 0 0 4.2 4.2l1.2-1.2" />
                </svg>
                {copied ? "Copied!" : "Get Link"}
              </span>
            </Button>

            <a
              href={`/api/attachments/${attachment.id}/download`}
              download={attachment.filename}
              className="flex items-center gap-1.5 rounded-[8px] border-0 bg-transparent px-3 py-1.5 text-[0.82rem] text-[rgba(245,240,232,0.6)] no-underline cursor-pointer transition-colors duration-140 hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.85)]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 2v9m0 0-3-3m3 3 3-3M3 13h10" />
              </svg>
              Download
            </a>

            <Button variant="icon" onClick={onClose}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Body — iframe */}
        <div className="relative flex-1 bg-white">
          {loading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(30,28,24,0.5)]">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[rgba(245,240,232,0.2)] border-t-[rgba(212,112,73,0.8)]" />
            </div>
          ) : null}
          <iframe
            src={`/api/attachments/${attachment.id}/content`}
            sandbox="allow-scripts"
            title={attachment.filename}
            className="h-full w-full border-0"
            onLoad={() => setLoading(false)}
          />
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
