"use client";

import { useEffect, useRef, useState } from "react";

export function RenameModal({
  currentTitle,
  onSave,
  onClose,
  isSaving,
}: {
  currentTitle: string;
  onSave: (title: string) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canSave = value.trim().length > 0 && value.trim() !== currentTitle;

  return (
    <div
      className="fixed inset-0 z-200 flex items-start justify-center pt-[20vh] bg-[rgba(0,0,0,0.5)] backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-[min(420px,90vw)] border border-[rgba(255,255,255,0.1)] rounded-[16px] bg-[rgba(42,40,36,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.5)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[rgba(245,240,232,0.92)] text-[1.05rem] font-semibold m-0">
            Rename chat
          </h2>
        </div>

        <div className="px-5 pb-5">
          <input
            ref={inputRef}
            type="text"
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3.5 py-2.5 text-[0.9rem] text-[rgba(245,240,232,0.92)] outline-none transition-colors focus:border-[rgba(255,255,255,0.25)] placeholder:text-[rgba(245,240,232,0.25)]"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSave(value.trim());
              if (e.key === "Escape") onClose();
            }}
            maxLength={200}
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 pb-5">
          <button
            type="button"
            className="rounded-[10px] border border-[rgba(255,255,255,0.12)] bg-transparent text-[rgba(245,240,232,0.78)] text-[0.84rem] font-medium cursor-pointer px-4 py-2 transition-all duration-140 hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.92)]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-[10px] border-0 bg-[rgba(245,240,232,0.92)] text-[rgba(30,28,24,0.95)] text-[0.84rem] font-semibold cursor-pointer px-4 py-2 transition-all duration-140 hover:bg-[rgba(245,240,232,1)] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => onSave(value.trim())}
            disabled={!canSave || isSaving}
          >
            {isSaving ? "Saving\u2026" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
