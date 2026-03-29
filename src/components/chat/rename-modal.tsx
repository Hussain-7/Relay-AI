"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalBackdrop, ModalPanel } from "@/components/ui/modal";

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
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-200 flex items-start justify-center pt-[20vh] bg-[rgba(0,0,0,0.5)] backdrop-blur-xs"
    >
      <ModalPanel className="w-[min(420px,90vw)] border border-[rgba(255,255,255,0.1)] rounded-[16px] bg-[rgba(42,40,36,0.98)] shadow-[0_24px_64px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[rgba(245,240,232,0.92)] text-[1.05rem] font-semibold m-0">Rename chat</h2>
        </div>

        <div className="px-5 pb-5">
          <Input
            ref={inputRef}
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(value.trim())} disabled={!canSave || isSaving}>
            {isSaving ? "Saving\u2026" : "Save"}
          </Button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}
