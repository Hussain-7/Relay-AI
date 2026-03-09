"use client";

import { useMemo, useState } from "react";

import type { RenderTimelineEntry } from "@/lib/chat-utils";
import { buildActivitySummary } from "@/lib/chat-utils";
import { IconChevron } from "@/components/icons";
import { ActivityStep } from "@/components/chat/activity-step";

export function RunActivityAccordion({
  entries,
  isLive,
}: {
  entries: RenderTimelineEntry[];
  isLive?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = useMemo(() => buildActivitySummary(entries, Boolean(isLive)), [entries, isLive]);

  return (
    <div className="activity-accordion w-[min(100%,780px)] max-w-full my-2 mb-4 max-[980px]:w-full max-[980px]:max-w-full">
      <button
        type="button"
        className="flex w-full min-w-0 items-center justify-start gap-2 border-0 bg-transparent text-inherit cursor-pointer py-1 px-0 text-left"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <span className={`min-w-0 text-[rgba(245,240,232,0.68)] text-[0.92rem] leading-[1.35] ${isLive ? "activity-shimmer" : ""}`}>{summary}</span>
        <span className="inline-flex items-center gap-2 text-[rgba(245,240,232,0.42)]">
          <span className={`inline-grid place-items-center transition-transform duration-[180ms] ease-linear ${isExpanded ? "rotate-0" : "-rotate-90"}`} aria-hidden="true">
            <IconChevron />
          </span>
        </span>
      </button>

      {isExpanded ? (
        <div className="mt-3.5">
          {entries.length ? (
            <ol className="m-0 p-0 list-none">
              {entries.map((entry, index) => (
                <ActivityStep key={entry.id} entry={entry} isLast={index === entries.length - 1} />
              ))}
            </ol>
          ) : (
            <div className="text-[rgba(245,240,232,0.58)] text-[0.92rem]">Preparing a response…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
