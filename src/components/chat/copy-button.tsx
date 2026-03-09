"use client";

import { useState } from "react";

import { IconCheck, IconCopy } from "@/components/icons";

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="inline-grid h-7 w-7 place-items-center border-0 rounded-[7px] bg-transparent text-[rgba(236,230,219,0.38)] cursor-pointer transition-[color,background] duration-[140ms] ease-linear hover:text-[rgba(245,240,232,0.82)] hover:bg-[rgba(255,255,255,0.06)]"
      aria-label={label ?? "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}
