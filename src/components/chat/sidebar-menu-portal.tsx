"use client";

import { createPortal } from "react-dom";

function IconStar({ filled }: { filled?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
      {filled ? (
        <path d="M8 1.5l2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.8 3.9 14l.8-4.5L1.5 6.3 6 5.6 8 1.5z" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
      ) : (
        <path d="M8 1.5l2 4.1 4.5.7-3.3 3.2.8 4.5L8 11.8 3.9 14l.8-4.5L1.5 6.3 6 5.6 8 1.5z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function IconPencil() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
      <path d="M11.13 1.87a1.75 1.75 0 0 1 2.47 0l.53.53a1.75 1.75 0 0 1 0 2.47L5.75 13.25 2 14l.75-3.75 8.38-8.38Zm1.41 1.06a.25.25 0 0 0-.35 0L4 11.12l-.3 1.5 1.5-.3L13.4 4.12a.25.25 0 0 0 0-.35l-.53-.53Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
      <path d="M5.5 2.5h5M2.5 4.5h11M6 4.5v7.5M10 4.5v7.5M3.5 4.5l.5 8.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-8.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SidebarMenuPortal({
  triggerSelector,
  isStarred,
  onToggleStar,
  onRename,
  onDelete,
  isDeleting,
}: {
  triggerSelector: string;
  isStarred: boolean;
  onToggleStar: () => void;
  onRename: () => void;
  onDelete: (event: React.MouseEvent) => void;
  isDeleting: boolean;
}) {
  return createPortal(
    <div
      className="fixed z-100 min-w-[170px] border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(42,40,36,0.98)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-[18px]"
      data-chat-action-menu
      ref={(el) => {
        if (!el) return;
        const btn = document.querySelector(triggerSelector);
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        el.style.top = `${rect.bottom + 6}px`;
        el.style.left = `${Math.max(8, rect.right - el.offsetWidth)}px`;
      }}
    >
      <button
        type="button"
        className="chat-action-menu-item flex w-full items-center gap-2.5 border-0 rounded-[8px] bg-transparent text-[rgba(245,240,232,0.82)] cursor-pointer px-3 py-[7px] text-left text-[0.84rem] leading-[1.2] transition-[background,color] duration-[140ms] ease-linear"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
      >
        <IconStar filled={isStarred} />
        {isStarred ? "Unstar" : "Star"}
      </button>
      <button
        type="button"
        className="chat-action-menu-item flex w-full items-center gap-2.5 border-0 rounded-[8px] bg-transparent text-[rgba(245,240,232,0.82)] cursor-pointer px-3 py-[7px] text-left text-[0.84rem] leading-[1.2] transition-[background,color] duration-[140ms] ease-linear"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
      >
        <IconPencil />
        Rename
      </button>
      <button
        type="button"
        className="chat-action-menu-item chat-action-menu-item-danger flex w-full items-center gap-2.5 border-0 rounded-[8px] bg-transparent text-[#f2c4b2] cursor-pointer px-3 py-[7px] text-left text-[0.84rem] leading-[1.2] transition-[background,color] duration-[140ms] ease-linear"
        onClick={onDelete}
        disabled={isDeleting}
      >
        <IconTrash />
        {isDeleting ? "Deleting\u2026" : "Delete"}
      </button>
    </div>,
    document.body,
  );
}
