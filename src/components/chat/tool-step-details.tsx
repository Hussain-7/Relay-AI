"use client";

import { useState } from "react";

import type { ToolTimelineEntry } from "@/lib/chat-utils";
import { getToolDetailLabel } from "@/lib/chat-utils";
import { IconChevron } from "@/components/icons";

export function ToolStepDetails({ entry }: { entry: ToolTimelineEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasInput = Boolean(entry.input.trim());
  const hasOutput = Boolean(entry.output.trim());
  const hasLogs = entry.logs.length > 0;

  if (!hasInput && !hasOutput && !hasLogs) {
    return null;
  }

  return (
    <div className="mt-2.5">
      <button
        type="button"
        className="inline-flex items-center gap-2 border-0 bg-transparent text-[rgba(245,240,232,0.54)] cursor-pointer p-0 text-[0.8rem] hover:text-[rgba(245,240,232,0.78)]"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <span>{getToolDetailLabel(entry)}</span>
        <span className={`inline-grid place-items-center transition-transform duration-[180ms] ease-linear ${isExpanded ? "rotate-0" : "-rotate-90"}`} aria-hidden="true">
          <IconChevron />
        </span>
      </button>

      {isExpanded ? (
        <div className="grid gap-3 mt-3 min-w-0">
          {hasInput ? (
            <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
              <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">Request</div>
              <pre className="overflow-auto m-0 rounded-[16px] bg-[rgba(8,8,8,0.4)] px-3.5 py-3 text-[rgba(255,255,255,0.82)] text-[0.78rem] leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere]" aria-label={`${entry.title} input`}>
                {entry.input}
              </pre>
            </section>
          ) : null}
          {hasLogs ? (
            <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
              <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">Processing</div>
              <ol className="m-0 p-0 list-none grid gap-1.5">
                {entry.logs.map((log) => (
                  <li key={log.id} className="flex items-center gap-2 text-[0.8rem] leading-[1.45] text-[rgba(245,240,232,0.62)]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[rgba(122,168,148,0.5)] shrink-0" aria-hidden="true" />
                    {log.message}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {hasOutput ? (
            <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
              <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">Response</div>
              <pre className="overflow-auto m-0 rounded-[16px] bg-[rgba(8,8,8,0.4)] px-3.5 py-3 text-[rgba(255,255,255,0.82)] text-[0.78rem] leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere] border border-[rgba(122,168,148,0.18)]" aria-label={`${entry.title} output`}>
                {entry.output}
              </pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
