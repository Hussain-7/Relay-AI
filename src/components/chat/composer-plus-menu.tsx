"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { IconConnector, IconGithub, IconPaperclip } from "@/components/icons";

interface McpConnectorItem {
  id: string;
  name: string;
  status: string;
}

/* ── Shared menu item style ── */

const menuItemClass =
  "flex w-full items-center gap-3 border-0 rounded-[12px] bg-transparent text-[rgba(245,240,232,0.86)] cursor-pointer px-3.5 py-2.5 text-left text-[0.88rem] transition-[background,color] duration-[160ms] ease-linear hover:bg-[rgba(255,255,255,0.06)]";

/* ── Toggle Switch ── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border-0 transition-colors duration-200 ${
        checked ? "bg-accent" : "bg-[rgba(255,255,255,0.12)]"
      }`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-[16px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
}

/* ── Connectors Submenu ── */

function ConnectorsSubmenu({
  connectors,
  onToggle,
  onManage,
}: {
  connectors: McpConnectorItem[];
  onToggle: (id: string, enabled: boolean) => void;
  onManage: () => void;
}) {
  const toggleable = connectors.filter((c) => c.status === "ACTIVE" || c.status === "DISABLED");
  const needsAuth = connectors.filter((c) => c.status === "NEEDS_AUTH" || c.status === "ERROR");

  return (
    <div
      className="absolute left-full top-0 -ml-3 min-w-[220px] max-w-[280px] border border-[rgba(255,255,255,0.12)] rounded-[14px] bg-[rgb(53,51,47)] p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.5)] z-10 max-[980px]:left-0 max-[980px]:bottom-full max-[980px]:top-auto max-[980px]:ml-0 max-[980px]:mb-1.5"
      data-chat-action-menu
    >
      {toggleable.length > 0 ? (
        <>
          {toggleable.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-[10px] px-3 py-2 transition-colors duration-100 hover:bg-[rgba(255,255,255,0.04)]"
            >
              <span className="flex-1 text-[0.84rem] text-[rgba(245,240,232,0.82)] truncate">{c.name}</span>
              <Toggle checked={c.status === "ACTIVE"} onChange={() => onToggle(c.id, c.status !== "ACTIVE")} />
            </div>
          ))}
          {needsAuth.length > 0 && (
            <>
              <div className="mx-3 my-1 h-px bg-[rgba(255,255,255,0.06)]" />
              {needsAuth.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-[10px] px-3 py-2">
                  <span className="flex-1 text-[0.84rem] text-[rgba(245,240,232,0.45)] truncate">{c.name}</span>
                  <span className="text-[0.68rem] text-[rgba(220,160,80,0.7)]">
                    {c.status === "NEEDS_AUTH" ? "Needs auth" : "Error"}
                  </span>
                </div>
              ))}
            </>
          )}
          <div className="mx-3 my-1 h-px bg-[rgba(255,255,255,0.06)]" />
        </>
      ) : (
        <div className="px-3 py-2.5 text-[0.82rem] text-[rgba(245,240,232,0.4)]">No connectors yet</div>
      )}
      <button type="button" className={menuItemClass} onClick={onManage}>
        <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.45)]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </span>
        Manage connectors
      </button>
    </div>
  );
}

/* ── Main Plus Menu ── */

export function ComposerPlusMenuPortal({
  anchor,
  onAddFiles,
  onAddConnectors,
  onConnectRepo,
  hasLinkedRepo,
  connectors = [],
  onToggleConnector,
}: {
  anchor: HTMLElement | null;
  onAddFiles: () => void;
  onAddConnectors: () => void;
  onConnectRepo: () => void;
  hasLinkedRepo: boolean;
  connectors?: McpConnectorItem[];
  onToggleConnector?: (id: string, enabled: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [showConnectorsSub, setShowConnectorsSub] = useState(false);

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
      <button type="button" className={menuItemClass} onClick={onAddFiles}>
        <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.56)]">
          <IconPaperclip />
        </span>
        Add files or photos
      </button>

      {/* Connectors with submenu */}
      <div
        className="relative"
        onMouseEnter={() => setShowConnectorsSub(true)}
        onMouseLeave={() => setShowConnectorsSub(false)}
      >
        <button
          type="button"
          className={`${menuItemClass} justify-between ${showConnectorsSub ? "bg-[rgba(255,255,255,0.06)]" : ""}`}
          onClick={() => setShowConnectorsSub((v) => !v)}
        >
          <span className="flex items-center gap-3">
            <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.56)]">
              <IconConnector />
            </span>
            Connectors
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="text-[rgba(245,240,232,0.3)] ml-2"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>

        {showConnectorsSub && (
          <ConnectorsSubmenu
            connectors={connectors}
            onToggle={(id, enabled) => onToggleConnector?.(id, enabled)}
            onManage={() => {
              setShowConnectorsSub(false);
              onAddConnectors();
            }}
          />
        )}
      </div>

      <button
        type="button"
        className={`${menuItemClass} ${hasLinkedRepo ? "!text-[rgba(245,240,232,0.35)] !cursor-default hover:!bg-transparent" : ""}`}
        onClick={hasLinkedRepo ? undefined : onConnectRepo}
        title={hasLinkedRepo ? "Disconnect the current repo first (click the repo chip)" : undefined}
      >
        <span className="inline-grid shrink-0 place-items-center text-[rgba(245,240,232,0.56)]">
          <IconGithub />
        </span>
        {hasLinkedRepo ? "Repository connected" : "Select a repository"}
      </button>
    </div>,
    document.body,
  );
}
