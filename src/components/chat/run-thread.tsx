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
}: {
  userPrompt: string;
  attachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  finalText: string | null;
  createdAt: string;
  isLive?: boolean;
  isLast?: boolean;
}) {
  const entries = useMemo(() => buildTimelineEntries(events), [events]);
  const showPendingCard = isLive && entries.length === 0 && !finalText;
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
          <div className="inline-flex min-w-0 flex-col items-start rounded-[20px] px-4 py-3 bg-[linear-gradient(180deg,rgba(19,18,16,0.94),rgba(14,13,12,0.96))] border border-[rgba(255,255,255,0.06)] shadow-[0_2px_8px_rgba(0,0,0,0.12)]" aria-label="User message">
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

      {entries.length || showPendingCard ? <RunActivityAccordion entries={entries} isLive={isLive} /> : null}

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
              {isLive ? <div className="mt-2.5 text-muted text-[0.76rem]">Streaming</div> : null}
            </div>
            {!isLive ? (
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
