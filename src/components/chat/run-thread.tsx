"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";

import type { AttachmentDto, TimelineEventEnvelope } from "@/lib/contracts";
import { buildTimelineEntries, formatShortTime } from "@/lib/chat-utils";
import { AttachmentChip } from "@/components/chat/attachment-chip";
import { CopyButton } from "@/components/chat/copy-button";
import { RunActivityAccordion } from "@/components/chat/activity-accordion";

export function RunThread({
  userPrompt,
  attachments,
  events,
  finalText,
  createdAt,
  isLive,
  isLast,
  isInterrupted,
  onRetry,
}: {
  userPrompt: string;
  attachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  finalText: string | null;
  createdAt: string;
  isLive?: boolean;
  isLast?: boolean;
  isInterrupted?: boolean;
  onRetry?: () => void;
}) {
  const entries = useMemo(() => buildTimelineEntries(events), [events]);
  const showPendingDot = isLive && entries.length === 0 && !finalText;
  const hasAgentResponse = Boolean(finalText);

  // Citation tooltip state
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCitationMouseOver(e: React.MouseEvent) {
    const anchor = (e.target as HTMLElement).closest("a[title], a[data-title]") as HTMLAnchorElement | null;
    if (!anchor) {
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
      tooltipTimeout.current = setTimeout(() => setTooltip(null), 100);
      return;
    }
    // Swap title → data-title to suppress native tooltip
    if (anchor.title) {
      anchor.setAttribute("data-title", anchor.title);
      anchor.removeAttribute("title");
    }
    const text = anchor.getAttribute("data-title");
    if (!text) return;
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    const rect = anchor.getBoundingClientRect();
    setTooltip({
      text,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  function handleCitationMouseOut(e: React.MouseEvent) {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest?.("a[data-title]")) return;
    if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    tooltipTimeout.current = setTimeout(() => setTooltip(null), 100);
  }

  useEffect(() => () => { if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current); }, []);

  // For the last run: if there's an agent response, show actions on agent row always; user row on hover.
  // If no agent response yet, user row is the last visible — show always.
  const userActionsAlwaysVisible = isLast && !hasAgentResponse;
  const agentActionsAlwaysVisible = isLast && hasAgentResponse;

  return (
    <>
    <article className="run-thread w-full mx-auto mb-[34px] max-w-[860px] min-w-0 [content-visibility:auto]">
      <div className="message-row flex w-full min-w-0 justify-end">
        <div className="group/msg flex flex-col max-w-[min(66%,40rem)] min-w-0 items-end max-[980px]:max-w-[min(84%,32rem)]">
          <div className="inline-flex min-w-0 flex-col items-start rounded-[.75rem] px-4 py-3 bg-[linear-gradient(180deg,rgba(19,18,16,0.94),rgba(14,13,12,0.96))] border border-[rgba(255,255,255,0.06)] shadow-[0_2px_8px_rgba(0,0,0,0.12)]" aria-label="User message">
            <div className="text-[0.98rem] leading-[1.52] [overflow-wrap:anywhere] break-words text-[rgba(245,240,232,0.96)] whitespace-pre-wrap">{userPrompt}</div>
            {attachments.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <AttachmentChip key={attachment.id} attachment={attachment} />
                ))}
              </div>
            ) : null}
          </div>
          <div className={`flex items-center gap-1 h-8 transition-opacity duration-[140ms] ease-linear ${userActionsAlwaysVisible ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}>
            <span className="text-[rgba(236,230,219,0.38)] text-[0.72rem] px-1 whitespace-nowrap">{formatShortTime(createdAt)}</span>
            <CopyButton text={userPrompt} label="Copy message" />
          </div>
        </div>
      </div>

      {showPendingDot ? (
        <div className="flex items-center py-3 px-1 text-accent">
          <span className="pending-spark-pulse inline-grid place-items-center">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8">
              <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
              <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" transform="rotate(45 12 12)" />
            </svg>
          </span>
        </div>
      ) : null}

      {entries.length > 0 ? <RunActivityAccordion entries={entries} isLive={isLive} /> : null}

      {finalText ? (
        <div className="message-row flex w-full min-w-0 justify-start">
          <div className="group/msg flex flex-col max-w-[min(100%,780px)] min-w-0 items-start max-[980px]:max-w-full">
            <div
              className="agent-response w-[min(100%,780px)] min-w-0 max-w-full pt-0.5 max-[980px]:w-full max-[980px]:max-w-full"
              aria-label="Assistant response"
              onMouseOver={handleCitationMouseOver}
              onMouseOut={handleCitationMouseOut}
              onClick={(e) => {
                const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
                if (anchor?.href) {
                  e.preventDefault();
                  window.open(anchor.href, "_blank", "noopener,noreferrer");
                }
              }}
            >
              <div className="chat-markdown mt-0 min-w-0 max-w-full">
                <Streamdown mode="streaming" isAnimating={Boolean(isLive)} caret="block" linkSafety={{ enabled: false }}>
                  {finalText}
                </Streamdown>
              </div>
              {isLive && !isInterrupted ? <div className="mt-2.5 text-muted text-[0.76rem]">Streaming</div> : null}
              {isInterrupted ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-[0.85rem] text-[rgba(236,230,219,0.6)]">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="shrink-0 opacity-60">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 5v3.5M8 10.5v.5" />
                    </svg>
                    Claude&apos;s response was interrupted
                  </div>
                  {onRetry ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-[8px] border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-3 py-1.5 text-[0.8rem] text-[rgba(236,230,219,0.8)] cursor-pointer transition-[background,border-color] duration-150 hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)]"
                      onClick={onRetry}
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!isLive && !isInterrupted ? (
              <div className={`flex items-center gap-1 h-8 transition-opacity duration-[140ms] ease-linear ${agentActionsAlwaysVisible ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}>
                <CopyButton text={finalText} label="Copy response" />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>

    {tooltip ? createPortal(
      <div
        className="citation-tooltip"
        style={{
          position: "fixed",
          left: tooltip.x,
          top: tooltip.y,
          transform: "translate(-50%, calc(-100% - 8px))",
          zIndex: 9999,
        }}
      >
        {tooltip.text}
      </div>,
      document.body,
    ) : null}
    </>
  );
}
