"use client";

import { useMemo, useState } from "react";
import { ActivityStep } from "@/components/chat/activity-step";
import { IconChevron } from "@/components/icons";
import type { RenderTimelineEntry } from "@/lib/chat-utils";
import { buildActivitySummary } from "@/lib/chat-utils";

// Persist user's manual toggle across remounts (live → completed transition).
// Keyed by runId so each run's accordion state is independent.
const userToggledRuns = new Map<string, boolean>();

// Track which runs have been auto-expanded for pending approvals
const autoExpandedForApproval = new Set<string>();

export function RunActivityAccordion({
  runId,
  segmentId,
  entries,
  isLive,
}: {
  runId?: string | null;
  /** When multiple accordions exist per run, each needs a unique key for toggle state. */
  segmentId?: string;
  entries: RenderTimelineEntry[];
  isLive?: boolean;
}) {
  // Composite key for toggle state — supports multiple accordions per run
  const stateKey = segmentId ? `${runId}-${segmentId}` : runId;
  const hasPendingApproval = entries.some((e) => e.kind === "approval" && e.status === "pending");

  const [isExpanded, setIsExpanded] = useState(() => {
    // If user previously toggled this accordion, respect that
    if (stateKey && userToggledRuns.has(stateKey)) {
      return userToggledRuns.get(stateKey)!;
    }
    // Auto-expand if there's already a pending approval on mount
    if (hasPendingApproval) {
      return true;
    }
    // Default: collapsed
    return false;
  });

  // Auto-expand when a pending approval arrives after mount.
  if (hasPendingApproval && stateKey && !autoExpandedForApproval.has(stateKey) && !isExpanded) {
    autoExpandedForApproval.add(stateKey);
    userToggledRuns.set(stateKey, true);
    setIsExpanded(true);
  }

  const summary = useMemo(() => buildActivitySummary(entries, Boolean(isLive)), [entries, isLive]);

  function handleToggle() {
    setIsExpanded((current) => {
      const next = !current;
      if (stateKey) {
        userToggledRuns.set(stateKey, next);
      }
      return next;
    });
  }

  return (
    <div className="activity-accordion w-[min(100%,780px)] max-w-full my-2 mb-4 max-[980px]:w-full max-[980px]:max-w-full">
      <button
        type="button"
        className="flex w-full min-w-0 items-center justify-start gap-2 border-0 bg-transparent text-inherit cursor-pointer py-1 px-0 text-left"
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <span
          className={`min-w-0 text-[rgba(245,240,232,0.68)] text-[0.92rem] leading-[1.35] ${isLive ? "activity-shimmer" : ""}`}
        >
          {summary}
        </span>
        <span className="inline-flex items-center gap-2 text-[rgba(245,240,232,0.42)]">
          <span
            className={`inline-grid place-items-center transition-transform duration-[180ms] ease-linear ${isExpanded ? "rotate-0" : "-rotate-90"}`}
            aria-hidden="true"
          >
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
