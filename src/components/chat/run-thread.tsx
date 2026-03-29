"use client";

import { code } from "@streamdown/code";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";
import { RunActivityAccordion } from "@/components/chat/activity-accordion";
import { AttachmentChip } from "@/components/chat/attachment-chip";
import { CopyButton } from "@/components/chat/copy-button";
import { HtmlPreviewModal } from "@/components/chat/html-preview-modal";
import { buildTimelineEntries, formatShortTime, groupEntriesIntoSegments, isHtmlAttachment } from "@/lib/chat-utils";
import type { AttachmentDto, TimelineEventEnvelope } from "@/lib/contracts";

function getFileTypeBadge(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "html":
    case "htm":
      return "HTML";
    case "xlsx":
      return "Excel";
    case "pptx":
      return "PowerPoint";
    case "docx":
      return "Word";
    case "pdf":
      return "PDF";
    case "csv":
      return "CSV";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return "Image";
    default:
      return ext?.toUpperCase() ?? "File";
  }
}

/** Max collapsed height in px — roughly 10 lines of text */
const COLLAPSE_THRESHOLD = 240;

function CollapsibleText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setNeedsCollapse(el.scrollHeight > COLLAPSE_THRESHOLD);
  }, [text]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const collapsed = needsCollapse && !expanded;

  return (
    <div>
      <div className="relative">
        <div
          ref={ref}
          className="text-[0.98rem] leading-[1.52] [overflow-wrap:anywhere] break-words text-[rgba(245,240,232,0.96)] whitespace-pre-wrap transition-[max-height] duration-200 ease-out"
          style={collapsed ? { maxHeight: COLLAPSE_THRESHOLD, overflow: "hidden" } : undefined}
        >
          {text}
        </div>
        {collapsed && (
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[rgba(14,13,12,1)] via-[rgba(14,13,12,0.85)] to-transparent pointer-events-none" />
        )}
      </div>
      {needsCollapse && (
        <button
          type="button"
          onClick={toggle}
          className="relative z-10 mt-0.5 text-[0.82rem] text-[rgba(236,230,219,0.5)] hover:text-[rgba(236,230,219,0.8)] transition-colors cursor-pointer"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function RunThread({
  runId,
  userPrompt,
  attachments,
  outputAttachments = [],
  events,
  finalText,
  createdAt,
  isLive,
  isLast,
  isInterrupted,
  onRetry,
  previewUrls,
}: {
  runId?: string | null;
  userPrompt: string;
  attachments: AttachmentDto[];
  outputAttachments?: AttachmentDto[];
  events: TimelineEventEnvelope[];
  finalText: string | null;
  createdAt: string;
  isLive?: boolean;
  isLast?: boolean;
  isInterrupted?: boolean;
  onRetry?: () => void;
  /** Local object URLs for image previews (keyed by attachment ID). */
  previewUrls?: Map<string, string>;
}) {
  const entries = useMemo(() => buildTimelineEntries(events), [events]);
  const segments = useMemo(() => groupEntriesIntoSegments(entries), [entries]);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentDto | null>(null);
  const showPendingDot = isLive && entries.length === 0 && !finalText;
  const hasAgentResponse = Boolean(finalText);

  // Extract total cost from events (main agent + coding agent)
  const totalCostUsd = useMemo(() => {
    let cost = 0;
    for (const event of events) {
      if (event.type === "assistant.message.completed" && typeof event.payload?.costUsd === "number") {
        cost += event.payload.costUsd;
      }
      if (event.type === "coding.agent.usage" && typeof event.payload?.costUsd === "number") {
        cost += event.payload.costUsd;
      }
    }
    return cost > 0 ? cost : null;
  }, [events]);

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

  useEffect(
    () => () => {
      if (tooltipTimeout.current) clearTimeout(tooltipTimeout.current);
    },
    [],
  );

  // For the last run: if there's an agent response, show actions on agent row always; user row on hover.
  // If no agent response yet, user row is the last visible — show always.
  const userActionsAlwaysVisible = isLast && !hasAgentResponse;
  const agentActionsAlwaysVisible = isLast && hasAgentResponse;

  return (
    <>
      <article className="run-thread w-full mx-auto mb-[34px] max-w-[860px] min-w-0 [content-visibility:auto]">
        <div className="message-row flex w-full min-w-0 justify-end">
          <div className="group/msg flex flex-col max-w-[min(66%,40rem)] min-w-0 items-end max-[980px]:max-w-[min(84%,32rem)]">
            <div
              className="inline-flex min-w-0 flex-col items-start rounded-[.75rem] px-4 py-3 bg-[linear-gradient(180deg,rgba(19,18,16,0.94),rgba(14,13,12,0.96))] border border-[rgba(255,255,255,0.06)] shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
              aria-label="User message"
            >
              <CollapsibleText text={userPrompt} />
              {attachments.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      attachment={attachment}
                      previewUrl={previewUrls?.get(attachment.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
            <div
              className={`flex items-center gap-1 h-8 transition-opacity duration-[140ms] ease-linear ${userActionsAlwaysVisible ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}
            >
              <span className="text-[rgba(236,230,219,0.38)] text-[0.72rem] px-1 whitespace-nowrap">
                {formatShortTime(createdAt)}
              </span>
              <CopyButton text={userPrompt} label="Copy message" />
            </div>
          </div>
        </div>

        {showPendingDot ? (
          <div className="flex items-center py-3 px-1 text-accent">
            <span className="pending-spark-pulse inline-grid place-items-center">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8">
                <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
                <path
                  d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z"
                  fill="currentColor"
                  transform="rotate(45 12 12)"
                />
              </svg>
            </span>
          </div>
        ) : null}

        {/* Interleaved text blocks and timeline accordions */}
        {segments.map((segment) => {
          if (segment.kind === "text") {
            return (
              <div key={segment.id} className="message-row flex w-full min-w-0 justify-start">
                <div className="flex flex-col max-w-[min(100%,780px)] min-w-0 items-start max-[980px]:max-w-full">
                  <div className="agent-response w-[min(100%,780px)] min-w-0 max-w-full pt-0.5 max-[980px]:w-full max-[980px]:max-w-full">
                    <div className="chat-markdown mt-0 min-w-0 max-w-full">
                      <Streamdown
                        mode="streaming"
                        isAnimating={false}
                        caret="block"
                        linkSafety={{ enabled: false }}
                        plugins={{ code }}
                      >
                        {segment.text}
                      </Streamdown>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <RunActivityAccordion
              key={segment.id}
              runId={runId}
              segmentId={segment.id}
              entries={segment.entries}
              isLive={isLive}
            />
          );
        })}

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
                  <Streamdown
                    mode="streaming"
                    isAnimating={Boolean(isLive)}
                    caret="block"
                    linkSafety={{ enabled: false }}
                    plugins={{ code }}
                  >
                    {finalText}
                  </Streamdown>
                </div>
                {outputAttachments.length > 0
                  ? (() => {
                      // Images are already rendered inline via markdown by the model — skip them here
                      const fileOutputs = outputAttachments.filter((a) => a.kind !== "IMAGE");
                      return fileOutputs.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {fileOutputs.map((file) =>
                            isHtmlAttachment(file) ? (
                              <div
                                key={file.id}
                                className="flex items-center gap-2 min-w-[120px] max-w-[280px] border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(255,255,255,0.04)] px-3 py-2.5 transition-[border-color,background] duration-[140ms] ease-linear hover:border-[rgba(181,103,69,0.4)] hover:bg-[rgba(181,103,69,0.06)]"
                              >
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="text-[0.8rem] leading-[1.3] text-[rgba(245,240,232,0.86)] overflow-hidden text-ellipsis whitespace-nowrap">
                                    {file.filename}
                                  </span>
                                  <span className="text-[0.65rem] text-[rgba(245,240,232,0.5)] uppercase tracking-[0.04em]">
                                    HTML
                                  </span>
                                </div>
                                {/* Preview button */}
                                <button
                                  type="button"
                                  onClick={() => setPreviewAttachment(file)}
                                  title="Preview"
                                  className="shrink-0 flex items-center justify-center w-7 h-7 rounded-[6px] border-0 bg-transparent text-[rgba(245,240,232,0.5)] cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-[rgba(212,112,73,0.9)]"
                                >
                                  <svg
                                    width="15"
                                    height="15"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" />
                                    <circle cx="8" cy="8" r="2" />
                                  </svg>
                                </button>
                                {/* Download button */}
                                <a
                                  href={`/api/attachments/${file.id}/download`}
                                  download={file.filename}
                                  title="Download"
                                  className="shrink-0 flex items-center justify-center w-7 h-7 rounded-[6px] bg-transparent text-[rgba(245,240,232,0.5)] no-underline transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-[rgba(212,112,73,0.9)]"
                                >
                                  <svg
                                    width="15"
                                    height="15"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="M8 2v9m0 0-3-3m3 3 3-3M3 13h10" />
                                  </svg>
                                </a>
                              </div>
                            ) : (
                              <a
                                key={file.id}
                                href={`/api/attachments/${file.id}/download`}
                                download={file.filename}
                                className="group/dl flex items-center gap-2 min-w-[120px] max-w-[240px] border border-[rgba(255,255,255,0.1)] rounded-[12px] bg-[rgba(255,255,255,0.04)] px-3 py-2.5 no-underline transition-[border-color,background] duration-[140ms] ease-linear hover:border-[rgba(181,103,69,0.4)] hover:bg-[rgba(181,103,69,0.06)]"
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className="shrink-0 text-[rgba(245,240,232,0.5)] group-hover/dl:text-[rgba(212,112,73,0.8)]"
                                >
                                  <path d="M8 2v9m0 0-3-3m3 3 3-3M3 13h10" />
                                </svg>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <span className="text-[0.8rem] leading-[1.3] text-[rgba(245,240,232,0.86)] overflow-hidden text-ellipsis whitespace-nowrap">
                                    {file.filename}
                                  </span>
                                  <span className="text-[0.65rem] text-[rgba(245,240,232,0.5)] uppercase tracking-[0.04em]">
                                    {getFileTypeBadge(file.filename)}
                                  </span>
                                </div>
                              </a>
                            ),
                          )}
                        </div>
                      ) : null;
                    })()
                  : null}
                {isLive && !isInterrupted ? <div className="mt-2.5 text-muted text-[0.76rem]">Streaming</div> : null}
                {isInterrupted ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-[0.85rem] text-[rgba(236,230,219,0.6)]">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        className="shrink-0 opacity-60"
                      >
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
                <div
                  className={`flex items-center gap-1 h-8 transition-opacity duration-[140ms] ease-linear ${agentActionsAlwaysVisible ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"}`}
                >
                  <CopyButton text={finalText} label="Copy response" />
                  {totalCostUsd != null ? (
                    <span
                      className="text-[rgba(236,230,219,0.34)] text-[0.7rem] px-1 tabular-nums"
                      title={`Total cost: $${totalCostUsd.toFixed(6)}`}
                    >
                      ${totalCostUsd < 0.01 ? totalCostUsd.toFixed(4) : totalCostUsd.toFixed(2)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </article>

      {tooltip
        ? createPortal(
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
          )
        : null}

      {previewAttachment && (
        <HtmlPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </>
  );
}
