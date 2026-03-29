"use client";

import { useEffect } from "react";

// ── Backdrop ─────────────────────────────────────────────────────────────────

interface ModalBackdropProps {
  onClose: () => void;
  /** Centers content vertically by default. Use `align="top"` + `pt-[20vh]` for top-aligned modals. */
  className?: string;
  children: React.ReactNode;
}

export function ModalBackdrop({ onClose, className, children }: ModalBackdropProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className={
        className ?? "fixed inset-0 z-200 flex items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-[4px]"
      }
      onClick={onClose}
    >
      {children}
    </div>
  );
}

// ── Content panel ────────────────────────────────────────────────────────────

interface ModalPanelProps {
  className?: string;
  children: React.ReactNode;
}

export function ModalPanel({ className, children }: ModalPanelProps) {
  return (
    <div
      className={
        className ??
        "w-[min(480px,92vw)] max-h-[80vh] flex flex-col border border-[rgba(255,255,255,0.08)] rounded-[20px] bg-[rgba(30,28,24,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.55)] overflow-hidden"
      }
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

interface ModalHeaderProps {
  title: string;
  onClose?: () => void;
  children?: React.ReactNode;
}

export function ModalHeader({ title, onClose, children }: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-3.5">
      <h2 className="text-[rgba(245,240,232,0.92)] text-[1.05rem] font-semibold m-0">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-[rgba(245,240,232,0.4)] cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.7)]"
          >
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
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-2.5 px-5 pb-5">{children}</div>;
}
