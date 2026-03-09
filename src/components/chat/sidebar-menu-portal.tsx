"use client";

import { createPortal } from "react-dom";

export function SidebarMenuPortal({
  triggerSelector,
  onDelete,
  isDeleting,
}: {
  triggerSelector: string;
  onDelete: (event: React.MouseEvent) => void;
  isDeleting: boolean;
}) {
  return createPortal(
    <div
      className="fixed z-100 min-w-[160px] border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(42,40,36,0.98)] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-[18px]"
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
        className="chat-action-menu-item chat-action-menu-item-danger flex w-full items-center justify-start border-0 rounded-[8px] bg-transparent text-[#f2c4b2] cursor-pointer px-3 py-2 text-left text-[0.88rem] leading-[1.2] transition-[background,color] duration-[140ms] ease-linear"
        onClick={onDelete}
        disabled={isDeleting}
      >
        {isDeleting ? "Deleting\u2026" : "Delete chat"}
      </button>
    </div>,
    document.body,
  );
}
