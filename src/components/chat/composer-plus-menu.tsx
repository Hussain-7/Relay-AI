"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { IconPaperclip, IconConnector, IconGithub } from "@/components/icons";

export function ComposerPlusMenuPortal({
  anchor,
  onAddFiles,
  onAddConnectors,
  onConnectRepo,
  hasLinkedRepo,
}: {
  anchor: HTMLElement | null;
  onAddFiles: () => void;
  onAddConnectors: () => void;
  onConnectRepo: () => void;
  hasLinkedRepo: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !panelRef.current) return;

    const updatePosition = () => {
      if (!anchor || !panelRef.current) return;
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const left = Math.max(12, rect.left);

      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(12, rect.top - panel.offsetHeight - 8)}px`;
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      className="fixed z-70 min-w-[200px] border border-[rgba(255,255,255,0.12)] rounded-[16px] bg-[linear-gradient(180deg,rgba(65,63,58,0.98),rgba(53,51,47,0.98)),rgba(24,22,19,0.98)] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.4)] backdrop-blur-[22px]"
      data-chat-action-menu
      ref={panelRef}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 border-0 rounded-[12px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer px-3.5 py-2.5 text-left text-[0.88rem] transition-[background,color] duration-[160ms] ease-linear hover:bg-[rgba(255,255,255,0.06)]"
        onClick={onAddFiles}
      >
        <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.56)]">
          <IconPaperclip />
        </span>
        Add files or photos
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-3 border-0 rounded-[12px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer px-3.5 py-2.5 text-left text-[0.88rem] transition-[background,color] duration-[160ms] ease-linear hover:bg-[rgba(255,255,255,0.06)]"
        onClick={onAddConnectors}
      >
        <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.56)]">
          <IconConnector />
        </span>
        Add connectors
      </button>
      <button
        type="button"
        className={`flex w-full items-center gap-3 border-0 rounded-[12px] bg-transparent cursor-pointer px-3.5 py-2.5 text-left text-[0.88rem] transition-[background,color] duration-[160ms] ease-linear ${hasLinkedRepo ? "text-[rgba(245,240,232,0.35)] cursor-default" : "text-[rgba(245,240,232,0.86)] hover:bg-[rgba(255,255,255,0.06)]"}`}
        onClick={hasLinkedRepo ? undefined : onConnectRepo}
        title={hasLinkedRepo ? "Disconnect the current repo first (click the repo chip)" : undefined}
      >
        <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.56)]">
          <IconGithub />
        </span>
        {hasLinkedRepo ? "Repo connected" : "Connect repo"}
      </button>
    </div>,
    document.body,
  );
}
