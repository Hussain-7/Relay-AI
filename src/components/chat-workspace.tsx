"use client";

import { startTransition, useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";

import type { AttachmentDto, ConversationDetailDto, ModelCatalogDto, TimelineEventEnvelope } from "@/lib/contracts";
import { useChatStore } from "@/lib/chat-store";

type LiveRunState = {
  runId: string | null;
  userPrompt: string;
  attachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  partialText: string;
  status: "running" | "failed";
  error: string | null;
};

type ToolTimelineEntry = {
  id: string;
  kind: "tool";
  title: string;
  runtime: string | null;
  status: "running" | "completed" | "failed";
  input: string;
  output: string;
};

type RenderTimelineEntry =
  | {
      id: string;
      kind: "thinking";
      text: string;
    }
  | ToolTimelineEntry
  | {
      id: string;
      kind: "system";
      title: string;
      description: string;
    }
  | {
      id: string;
      kind: "approval";
      title: string;
      description: string;
    };

function IconClose() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebarToggle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SidebarMenuPortal({
  triggerSelector,
  onDelete,
  isDeleting,
}: {
  triggerSelector: string;
  onDelete: (event: React.MouseEvent) => void;
  isDeleting: boolean;
}) {
  return createPortal(
    <div
      className="sidebar-action-menu"
      data-chat-action-menu
      ref={(el) => {
        if (!el) return;
        const btn = document.querySelector(triggerSelector);
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        el.style.top = `${rect.bottom + 6}px`;
        el.style.left = `${Math.max(8, rect.right - el.offsetWidth)}px`;
      }}
    >
      <button
        type="button"
        className="chat-action-menu-item chat-action-menu-item-danger"
        onClick={onDelete}
        disabled={isDeleting}
      >
        {isDeleting ? "Deleting…" : "Delete chat"}
      </button>
    </div>,
    document.body,
  );
}

function ComposerModelMenuPortal({
  anchor,
  models,
  selectedModelId,
  isUpdating,
  onSelect,
}: {
  anchor: HTMLElement | null;
  models: ModelCatalogDto["availableMainModels"];
  selectedModelId: string;
  isUpdating: boolean;
  onSelect: (modelId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !panelRef.current) return;

    const updatePosition = () => {
      if (!anchor || !panelRef.current) return;
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const width = Math.min(336, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12);

      panel.style.width = `${width}px`;
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(12, rect.top - panel.offsetHeight - 10)}px`;
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, models.length]);

  return createPortal(
    <div
      className="composer-model-dropdown"
      data-chat-action-menu
      ref={panelRef}
    >
      <div className="composer-model-dropdown-header">Choose model</div>
      {models.map((model) => {
        const isSelected = selectedModelId === model.id;

        return (
          <button
            key={model.id}
            type="button"
            className={`composer-model-option ${isSelected ? "composer-model-option-selected" : ""}`}
            onClick={() => onSelect(model.id)}
            disabled={isUpdating}
          >
            <span className="composer-model-option-copy">
              <span className="composer-model-option-label">{model.label}</span>
              <span className="composer-model-option-description">{model.description}</span>
            </span>
            {isSelected ? (
              <span className="composer-model-option-check" aria-hidden="true">
                <IconCheck />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function IconPlus() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconArrowUp() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M12 18V7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="m7.5 11.5 4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="m8 10 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx="5" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="19" cy="12" r="1.75" fill="currentColor" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="m6.5 12.5 3.4 3.4 7.6-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTool() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M14.5 6.5a4 4 0 0 0-5.2 5.2l-4.6 4.6a1.4 1.4 0 1 0 2 2l4.6-4.6a4 4 0 0 0 5.2-5.2l-2.1 2.1-1.9-1.9 2-2.2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconThinking() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M12 6v6l3 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconDone() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="m8.5 12.2 2.3 2.4 4.8-5.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.5v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1" fill="currentColor" />
    </svg>
  );
}

function formatTimeLabel(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function previewText(value: string | null) {
  if (!value) {
    return "No reply yet";
  }

  return value.length > 82 ? `${value.slice(0, 82)}…` : value;
}

function stringifyUnknown(value: unknown) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatModelDisplayName(model: string | null | undefined) {
  if (!model) {
    return "Model";
  }

  if (model.includes("sonnet")) {
    const match = model.match(/sonnet-(\d+)-(\d+)/i);
    const version = match ? `${match[1]}.${match[2]}` : "";
    return version ? `Sonnet ${version}` : "Sonnet";
  }

  if (model.includes("opus")) {
    const match = model.match(/opus-(\d+)-(\d+)/i);
    const version = match ? `${match[1]}.${match[2]}` : "";
    return version ? `Opus ${version}` : "Opus";
  }

  return model.replace(/^claude-/i, "").replaceAll("-", " ");
}

function formatToolDisplayName(name: string) {
  return name
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatToolRuntimeLabel(runtime: string | null) {
  switch (runtime) {
    case "anthropic_server":
      return "Built-in";
    case "anthropic_client":
      return "Connected";
    default:
      return runtime ? runtime.replaceAll("_", " ") : null;
  }
}

function formatToolStatusLabel(status: ToolTimelineEntry["status"]) {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function summarizeToolAction(name: string) {
  switch (name) {
    case "web_search":
      return "Searched the web";
    case "web_fetch":
      return "Fetched source pages";
    case "memory":
      return "Checked saved memory";
    case "code_execution":
      return "Ran code";
    case "tool_search":
    case "tool_search_tool_regex":
      return "Looked for tools";
    default:
      return `Used ${formatToolDisplayName(name)}`;
  }
}

function buildActivitySummary(entries: RenderTimelineEntry[], isLive: boolean) {
  const toolSummaries = Array.from(
    new Set(entries.filter((entry): entry is ToolTimelineEntry => entry.kind === "tool").map((entry) => summarizeToolAction(entry.title))),
  );

  if (toolSummaries.length === 1) {
    return toolSummaries[0]!;
  }

  if (toolSummaries.length === 2) {
    return `${toolSummaries[0]}, then ${toolSummaries[1].toLowerCase()}`;
  }

  if (toolSummaries.length > 2) {
    return `${toolSummaries[0]}, ${toolSummaries[1].toLowerCase()}, and ${toolSummaries.length - 2} more steps`;
  }

  if (entries.some((entry) => entry.kind === "thinking")) {
    return isLive ? "Thinking through the answer" : "Reasoned through the answer";
  }

  if (entries.some((entry) => entry.kind === "approval")) {
    return "Handled a decision";
  }

  if (entries.some((entry) => entry.kind === "system")) {
    return "View run details";
  }

  return isLive ? "Working on it" : "View activity";
}

function getToolDetailLabel(entry: ToolTimelineEntry) {
  const hasInput = Boolean(entry.input.trim());
  const hasOutput = Boolean(entry.output.trim());

  if (hasInput && hasOutput) {
    return "View request and response";
  }

  if (hasInput) {
    return "View request";
  }

  if (hasOutput) {
    return "View result";
  }

  return "View details";
}

const landingSuggestions = [
  "Plan a product MVP",
  "Research a technical topic",
  "Review an architecture idea",
  "Map out a coding task",
];

function normalizeApiErrorMessage(message: string) {
  const jsonStart = message.indexOf("{");

  if (jsonStart === -1) {
    return message;
  }

  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as {
      error?: { message?: string | null } | null;
      message?: string | null;
    };

    return parsed.error?.message ?? parsed.message ?? message;
  } catch {
    return message;
  }
}

function resizeComposer(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function buildTimelineEntries(events: TimelineEventEnvelope[]) {
  const entries: RenderTimelineEntry[] = [];
  const toolEntries = new Map<string, ToolTimelineEntry>();
  let thinkingEntry: Extract<RenderTimelineEntry, { kind: "thinking" }> | null = null;

  const flushThinking = () => {
    if (thinkingEntry?.text.trim()) {
      entries.push(thinkingEntry);
    }

    thinkingEntry = null;
  };

  for (const event of events) {
    if (event.type !== "assistant.thinking.delta") {
      flushThinking();
    }

    switch (event.type) {
      case "assistant.thinking.delta": {
        if (!thinkingEntry) {
          thinkingEntry = {
            id: `thinking-${event.id}`,
            kind: "thinking",
            text: "",
          };
        }

        thinkingEntry.text += typeof event.payload?.delta === "string" ? event.payload.delta : "";
        break;
      }
      case "tool.call.started": {
        const key =
          (typeof event.payload?.toolUseId === "string" && event.payload.toolUseId) ||
          `${String(event.payload?.toolName ?? "tool")}-${event.id}`;
        const toolEntry: ToolTimelineEntry = {
          id: key,
          kind: "tool",
          title: String(event.payload?.toolName ?? "Tool call"),
          runtime: typeof event.payload?.toolRuntime === "string" ? event.payload.toolRuntime : null,
          status: "running",
          input: stringifyUnknown(event.payload?.input),
          output: "",
        };
        toolEntries.set(key, toolEntry);
        entries.push(toolEntry);
        break;
      }
      case "tool.call.input.delta": {
        const key =
          (typeof event.payload?.toolUseId === "string" && event.payload.toolUseId) ||
          `${String(event.payload?.toolName ?? "tool")}-${String(event.payload?.index ?? event.id)}`;
        const existing = toolEntries.get(key);
        if (existing) {
          existing.input = typeof event.payload?.snapshot === "string" ? event.payload.snapshot : existing.input;
        }
        break;
      }
      case "tool.call.completed":
      case "tool.call.failed": {
        const candidateName = String(event.payload?.toolName ?? "Tool call");
        const key =
          (typeof event.payload?.toolUseId === "string" && event.payload.toolUseId) ||
          Array.from(toolEntries.values())
            .reverse()
            .find((entry) => entry.title === candidateName)?.id ||
          `${candidateName}-${event.id}`;
        const existing = toolEntries.get(key);
        if (existing) {
          existing.status = event.type === "tool.call.completed" ? "completed" : "failed";
          existing.output =
            stringifyUnknown(event.payload?.result) ||
            stringifyUnknown(event.payload?.resultPreview) ||
            stringifyUnknown(event.payload?.error);
        } else {
          const toolEntry: ToolTimelineEntry = {
            id: key,
            kind: "tool",
            title: candidateName,
            runtime: typeof event.payload?.toolRuntime === "string" ? event.payload.toolRuntime : null,
            status: event.type === "tool.call.completed" ? "completed" : "failed",
            input: "",
            output:
              stringifyUnknown(event.payload?.result) ||
              stringifyUnknown(event.payload?.resultPreview) ||
              stringifyUnknown(event.payload?.error),
          };
          toolEntries.set(key, toolEntry);
          entries.push(toolEntry);
        }
        break;
      }
      case "coding.session.created":
      case "coding.session.ready":
      case "coding.session.paused":
      case "coding.session.resumed": {
        entries.push({
          id: event.id,
          kind: "system",
          title: event.type.replaceAll(".", " "),
          description: stringifyUnknown(event.payload),
        });
        break;
      }
      case "approval.requested":
      case "approval.resolved": {
        entries.push({
          id: event.id,
          kind: "approval",
          title: event.type === "approval.requested" ? "Approval requested" : "Approval resolved",
          description: stringifyUnknown(event.payload),
        });
        break;
      }
      case "run.failed": {
        entries.push({
          id: event.id,
          kind: "system",
          title: "Run failed",
          description: stringifyUnknown(event.payload?.error ?? event.payload),
        });
        break;
      }
      default:
        break;
    }
  }

  flushThinking();

  return entries;
}

function getFileTypeBadge(attachment: AttachmentDto) {
  if (attachment.kind === "PDF") return "PDF";
  if (attachment.kind === "IMAGE") return "IMG";
  const ext = attachment.filename.split(".").pop()?.toUpperCase() ?? "";
  if (["DOC", "DOCX"].includes(ext)) return "DOC";
  if (["XLS", "XLSX"].includes(ext)) return "XLS";
  if (["TXT", "MD", "JSON", "CSV"].includes(ext)) return ext;
  return "FILE";
}

function AttachmentChip({ attachment, onRemove }: { attachment: AttachmentDto; onRemove?: () => void }) {
  const badge = getFileTypeBadge(attachment);

  return (
    <div className="attachment-card">
      <div className="attachment-card-body">
        <span className="attachment-card-name">{attachment.filename}</span>
        <span className="attachment-card-badge">{badge}</span>
      </div>
      {onRemove ? (
        <button type="button" className="attachment-card-remove" onClick={onRemove} aria-label={`Remove ${attachment.filename}`}>
          <IconClose />
        </button>
      ) : null}
    </div>
  );
}

function ToolStepDetails({ entry }: { entry: ToolTimelineEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasInput = Boolean(entry.input.trim());
  const hasOutput = Boolean(entry.output.trim());

  if (!hasInput && !hasOutput) {
    return null;
  }

  return (
    <div className={`activity-step-details ${isExpanded ? "activity-step-details-open" : ""}`}>
      <button
        type="button"
        className="activity-step-detail-toggle"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <span>{getToolDetailLabel(entry)}</span>
        <span className={`activity-step-detail-chevron ${isExpanded ? "activity-step-detail-chevron-open" : ""}`} aria-hidden="true">
          <IconChevron />
        </span>
      </button>

      {isExpanded ? (
        <div className="activity-step-detail-body">
          {hasInput ? (
            <section className="activity-step-detail-panel">
              <div className="activity-step-detail-label">Request</div>
              <pre className="timeline-code" aria-label={`${entry.title} input`}>
                {entry.input}
              </pre>
            </section>
          ) : null}
          {hasOutput ? (
            <section className="activity-step-detail-panel">
              <div className="activity-step-detail-label">Response</div>
              <pre className="timeline-code timeline-code-output" aria-label={`${entry.title} output`}>
                {entry.output}
              </pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActivityStep({
  entry,
  isLast,
}: {
  entry: RenderTimelineEntry;
  isLast: boolean;
}) {
  if (entry.kind === "thinking") {
    return (
      <li className="activity-step">
        <div className="activity-step-rail" aria-hidden="true">
          <span className="activity-step-icon">
            <IconThinking />
          </span>
          {!isLast ? <span className="activity-step-line" /> : null}
        </div>
        <div className="activity-step-main">
          <div className="activity-step-text">{entry.text}</div>
        </div>
      </li>
    );
  }

  if (entry.kind === "tool") {
    return (
      <li className="activity-step">
        <div className="activity-step-rail" aria-hidden="true">
          <span className="activity-step-icon">
            <IconTool />
          </span>
          {!isLast ? <span className="activity-step-line" /> : null}
        </div>
        <div className="activity-step-main">
          <div className="activity-step-title-row">
            <div className="activity-step-title">{formatToolDisplayName(entry.title)}</div>
            <span className={`activity-step-status activity-step-status-${entry.status}`}>{formatToolStatusLabel(entry.status)}</span>
          </div>
          {entry.runtime ? <div className="activity-step-caption">{formatToolRuntimeLabel(entry.runtime)}</div> : null}
          <ToolStepDetails entry={entry} />
        </div>
      </li>
    );
  }

  return (
    <li className="activity-step">
      <div className="activity-step-rail" aria-hidden="true">
        <span className="activity-step-icon">
          {entry.kind === "system" ? <IconDone /> : <IconInfo />}
        </span>
        {!isLast ? <span className="activity-step-line" /> : null}
      </div>
      <div className="activity-step-main">
        <div className="activity-step-title">{entry.title}</div>
        <div className="activity-step-text">{entry.description}</div>
      </div>
    </li>
  );
}

function RunActivityAccordion({
  entries,
  isLive,
}: {
  entries: RenderTimelineEntry[];
  isLive?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = useMemo(() => buildActivitySummary(entries, Boolean(isLive)), [entries, isLive]);

  return (
    <div className={`activity-accordion ${isExpanded ? "activity-accordion-open" : ""}`}>
      <button
        type="button"
        className="activity-accordion-toggle"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <span className="activity-accordion-summary">{summary}</span>
        <span className="activity-accordion-meta">
          <span className={`activity-accordion-chevron ${isExpanded ? "activity-accordion-chevron-open" : ""}`} aria-hidden="true">
            <IconChevron />
          </span>
        </span>
      </button>

      {isExpanded ? (
        <div className="activity-accordion-body">
          {entries.length ? (
            <ol className="activity-step-list">
              {entries.map((entry, index) => (
                <ActivityStep key={entry.id} entry={entry} isLast={index === entries.length - 1} />
              ))}
            </ol>
          ) : (
            <div className="activity-accordion-empty">Preparing a response…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RunThread({
  userPrompt,
  attachments,
  events,
  finalText,
  createdAt,
  isLive,
}: {
  userPrompt: string;
  attachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  finalText: string | null;
  createdAt: string;
  isLive?: boolean;
}) {
  const entries = useMemo(() => buildTimelineEntries(events), [events]);
  const showPendingCard = isLive && entries.length === 0 && !finalText;

  return (
    <article className="run-thread">
      <div className="run-thread-meta">{formatTimeLabel(createdAt)}</div>

      <div className="message-row message-row-user">
        <div className="chat-bubble chat-bubble-user" aria-label="User message">
          <div className="chat-bubble-copy chat-bubble-copy-user whitespace-pre-wrap">{userPrompt}</div>
          {attachments.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <AttachmentChip key={attachment.id} attachment={attachment} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {entries.length || showPendingCard ? <RunActivityAccordion entries={entries} isLive={isLive} /> : null}

      {finalText ? (
        <div className="message-row message-row-agent">
          <div className="agent-response" aria-label="Assistant response">
            <div className="chat-markdown">
              <Streamdown mode="streaming" isAnimating={Boolean(isLive)} caret="block">
                {finalText}
              </Streamdown>
            </div>
            {isLive ? <div className="agent-response-footer">Streaming</div> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = "Request failed.";

    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // ignore
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function ChatWorkspace() {
  const catalog = useChatStore((s) => s.catalog);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversation = useChatStore((s) => s.activeConversation);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const hydrate = useChatStore((s) => s.hydrate);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const storeCreateConversation = useChatStore((s) => s.createConversation);
  const storeDeleteConversation = useChatStore((s) => s.deleteConversation);
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle);
  const storeRefreshConversation = useChatStore((s) => s.refreshConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  const [composerValue, setComposerValue] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<AttachmentDto[]>([]);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [liveRun, setLiveRun] = useState<LiveRunState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);
  const deferredSidebarQuery = useDeferredValue(sidebarQuery);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasLandingRef = useRef(true);
  const [animateComposerDock, setAnimateComposerDock] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const selectedMainModelId = activeConversation?.mainAgentModel ?? catalog?.mainAgentModel ?? "";

  const closeMenusOnOutsidePress = useEffectEvent((event: MouseEvent) => {
    if (profileRef.current && event.target instanceof Node && !profileRef.current.contains(event.target)) {
      setProfileMenuOpen(false);
    }

    if (!(event.target instanceof Element) || !event.target.closest("[data-chat-action-menu]")) {
      setOpenConversationMenuId(null);
      setHeaderMenuOpen(false);
      setModelMenuOpen(false);
    }
  });

  useEffect(() => {
    document.addEventListener("mousedown", closeMenusOnOutsidePress);

    return () => {
      document.removeEventListener("mousedown", closeMenusOnOutsidePress);
    };
  }, []);

  useEffect(() => {
    resizeComposer(composerInputRef.current);
  }, [composerValue]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const syncViewport = (event?: MediaQueryListEvent) => {
      const matches = event?.matches ?? mediaQuery.matches;
      setIsMobileViewport(matches);
      if (!matches) {
        setMobileSidebarOpen(false);
      }
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  const runs = activeConversation?.runs ?? [];
  const isLandingState = runs.length === 0 && !liveRun;

  useEffect(() => {
    if (wasLandingRef.current && !isLandingState) {
      setAnimateComposerDock(true);

      const timeout = window.setTimeout(() => {
        setAnimateComposerDock(false);
      }, 460);

      wasLandingRef.current = isLandingState;
      return () => window.clearTimeout(timeout);
    }

    wasLandingRef.current = isLandingState;
  }, [isLandingState]);

  useEffect(() => {
    hydrate().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load chats.");
    });
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeConversation, liveRun]);

  useEffect(() => {
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setModelMenuOpen(false);
    setMobileSidebarOpen(false);
  }, [activeConversation?.id]);

  const filteredConversations = useMemo(() => {
    const query = deferredSidebarQuery.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      return (
        conversation.title.toLowerCase().includes(query) ||
        previewText(conversation.latestSnippet).toLowerCase().includes(query)
      );
    });
  }, [conversations, deferredSidebarQuery]);

  async function refreshConversation(conversationId: string) {
    try {
      await storeRefreshConversation(conversationId);
      setMobileSidebarOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh the conversation.");
    }
  }

  async function handleCreateConversation() {
    // Optimistic: store adds a placeholder instantly
    setLiveRun(null);
    setComposerAttachments([]);
    setComposerValue("");
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setMobileSidebarOpen(false);

    try {
      await storeCreateConversation();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create a conversation.");
    }
  }

  async function handleDeleteConversation(conversationId: string) {
    if (deletingConversationId) return;

    // Optimistic: store removes from list instantly
    setDeletingConversationId(conversationId);
    setErrorMessage(null);
    setOpenConversationMenuId(null);
    setHeaderMenuOpen(false);
    setMobileSidebarOpen(false);

    try {
      await storeDeleteConversation(conversationId);
      if (activeConversationId === conversationId) {
        setLiveRun(null);
        setComposerAttachments([]);
        setComposerValue("");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete the chat.");
    } finally {
      setDeletingConversationId(null);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files?.length || !activeConversation) {
      return;
    }

    try {
      const uploaded: AttachmentDto[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("conversationId", activeConversation.id);
        formData.append("file", file);

        const response = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? "Upload failed.");
        }

        const body = (await response.json()) as { attachment: AttachmentDto };
        uploaded.push(body.attachment);
      }

      setComposerAttachments((existing) => [...existing, ...uploaded]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to upload attachment.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleSend() {
    if (!activeConversation || !composerValue.trim() || isSending) {
      return;
    }

    setIsSending(true);
    setErrorMessage(null);

    const prompt = composerValue.trim();
    const attachments = composerAttachments;

    setComposerValue("");
    setComposerAttachments([]);
    setLiveRun({
      runId: null,
      userPrompt: prompt,
      attachments,
      events: [],
      partialText: "",
      status: "running",
      error: null,
    });

    try {
      const response = await fetch(`/api/conversations/${activeConversation.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          attachmentIds: attachments.map((attachment) => attachment.id),
        }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({ error: "Failed to start stream." }))) as { error?: string };
        throw new Error(normalizeApiErrorMessage(body.error ?? "Failed to start stream."));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const segments = buffer.split("\n\n");
        buffer = segments.pop() ?? "";

        for (const segment of segments) {
          const line = segment
            .split("\n")
            .find((candidate) => candidate.startsWith("data: "));

          if (!line) {
            continue;
          }

          const event = JSON.parse(line.slice(6)) as TimelineEventEnvelope;

          if (event.type === "conversation.updated" && typeof event.payload?.title === "string") {
            updateConversationTitle(event.conversationId, event.payload.title);
          }

          setLiveRun((current) => {
            if (!current) {
              return current;
            }

            const nextPartialText =
              event.type === "assistant.text.delta"
                ? `${current.partialText}${String(event.payload?.delta ?? "")}`
                : current.partialText;

            return {
              ...current,
              runId: event.runId,
              partialText: nextPartialText,
              events: [...current.events, event],
              status: event.type === "run.failed" ? "failed" : current.status,
              error:
                event.type === "run.failed"
                  ? String(event.payload?.error ?? "The agent run failed.")
                  : current.error,
            };
          });
        }
      }

      const conversationId = activeConversation.id;
      await refreshConversation(conversationId);
      setLiveRun(null);
    } catch (error) {
      const message = error instanceof Error ? normalizeApiErrorMessage(error.message) : "Failed to send prompt.";
      setErrorMessage(message);
      setLiveRun((current) =>
        current
          ? {
              ...current,
              status: "failed",
              error: message,
              events: current.events.some((event) => event.type === "run.failed")
                ? current.events
                : [
                    ...current.events,
                    {
                      id: `client-run-failed-${Date.now()}`,
                      runId: current.runId ?? "pending",
                      conversationId: activeConversation.id,
                      type: "run.failed",
                      source: "system",
                      ts: new Date().toISOString(),
                      payload: {
                        error: message,
                      },
                    },
                  ],
            }
          : current,
      );
    } finally {
      setIsSending(false);
    }
  }

  async function handleSelectMainModel(modelId: string) {
    if (!activeConversation || isUpdatingModel || activeConversation.mainAgentModel === modelId) {
      setModelMenuOpen(false);
      return;
    }

    setIsUpdatingModel(true);
    setErrorMessage(null);

    try {
      const data = await fetchJson<{ conversation: ConversationDetailDto }>(`/api/conversations/${activeConversation.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          mainAgentModel: modelId,
        }),
      });

      startTransition(() => {
        setActiveConversation(data.conversation);
        setModelMenuOpen(false);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update the model.");
    } finally {
      setIsUpdatingModel(false);
    }
  }

  const showCollapsedSidebar = sidebarCollapsed && !isMobileViewport;

  return (
    <div className={`app-shell ${showCollapsedSidebar ? "app-shell-collapsed" : ""}`}>
      {isMobileViewport && mobileSidebarOpen ? (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <aside
        className={[
          "sidebar-panel",
          showCollapsedSidebar ? "sidebar-panel-collapsed" : "",
          isMobileViewport ? "sidebar-panel-mobile" : "",
          isMobileViewport && mobileSidebarOpen ? "sidebar-panel-mobile-open" : "",
        ].join(" ")}
      >
        {showCollapsedSidebar ? (
          <>
            <div className="sidebar-collapsed-strip">
              <button type="button" className="ghost-icon-button" aria-label="Expand sidebar" onClick={() => setSidebarCollapsed(false)}>
                <IconSidebarToggle />
              </button>
              <button type="button" className="ghost-icon-button" aria-label="New chat" onClick={handleCreateConversation}>
                <IconPlus />
              </button>
              <button type="button" className="ghost-icon-button" aria-label="Search chats" onClick={() => setSearchModalOpen(true)}>
                <IconSearch />
              </button>
            </div>
            <div className="sidebar-collapsed-avatar" role="button" tabIndex={0} onClick={() => setSidebarCollapsed(false)}>
              N
            </div>
          </>
        ) : (
          <>
        <div className="sidebar-brand">
          <div className="sidebar-brand-title">Relay AI</div>
          {isMobileViewport ? (
            <button type="button" className="ghost-icon-button" aria-label="Close sidebar" onClick={() => setMobileSidebarOpen(false)}>
              <IconClose />
            </button>
          ) : (
            <button type="button" className="ghost-icon-button" aria-label="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}>
              <IconSidebarToggle />
            </button>
          )}
        </div>

        <button type="button" className="sidebar-row" onClick={handleCreateConversation}>
          <span className="sidebar-row-icon"><IconPlus /></span>
          <span>New chat</span>
        </button>

        <button type="button" className="sidebar-row" onClick={() => setSearchModalOpen(true)}>
          <span className="sidebar-row-icon"><IconSearch /></span>
          <span>Search</span>
        </button>

        <div className="sidebar-section-label">Chats</div>
        <div className="sidebar-conversation-list">
          {filteredConversations.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            const isMenuOpen = openConversationMenuId === conversation.id;
            const isDeleting = deletingConversationId === conversation.id;
            return (
              <div
                key={conversation.id}
                className={`conversation-row-shell ${isActive ? "conversation-row-shell-active" : ""} ${isMenuOpen ? "conversation-row-shell-menu-open" : ""}`}
              >
                <button
                  type="button"
                  className={`conversation-row ${isActive ? "conversation-row-active" : ""}`}
                  onClick={() => {
                    setMobileSidebarOpen(false);
                    void selectConversation(conversation.id).catch((error) => {
                      setErrorMessage(error instanceof Error ? error.message : "Failed to load conversation.");
                    });
                  }}
                >
                  <div className="conversation-row-title">{conversation.title}</div>
                </button>

                <div className="conversation-row-actions" data-chat-action-menu>
                  <button
                    type="button"
                    className="conversation-row-menu-button"
                    aria-label={`Open menu for ${conversation.title}`}
                    aria-expanded={isMenuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setHeaderMenuOpen(false);
                      setOpenConversationMenuId((current) => (current === conversation.id ? null : conversation.id));
                    }}
                  >
                    <IconMore />
                  </button>

                  {isMenuOpen ? (
                    <SidebarMenuPortal
                      triggerSelector={`[aria-label="Open menu for ${CSS.escape(conversation.title)}"]`}
                      onDelete={(event) => {
                        event.stopPropagation();
                        void handleDeleteConversation(conversation.id);
                      }}
                      isDeleting={isDeleting}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="sidebar-profile" ref={profileRef}>
          <button
            type="button"
            className="sidebar-profile-button"
            onClick={() => setProfileMenuOpen((current) => !current)}
          >
            <div className="sidebar-profile-avatar">N</div>
            <div className="min-w-0">
              <div className="sidebar-profile-name">Demo account</div>
              <div className="sidebar-profile-plan">Local development mode</div>
            </div>
            <span className="sidebar-profile-chevron"><IconChevron /></span>
          </button>

          {profileMenuOpen ? (
            <div className="profile-menu">
              <div className="profile-menu-row">
                <span>Model</span>
                <strong>{formatModelDisplayName(catalog?.mainAgentModel) ?? "Loading"}</strong>
              </div>
              <div className="profile-menu-row">
                <span>Tools</span>
                <strong>{catalog?.builtInTools.filter((tool) => tool.enabled).length ?? 0}</strong>
              </div>
            </div>
          ) : null}
        </div>
          </>
        )}
      </aside>

      <main className={`chat-panel ${isLandingState ? "chat-panel-landing" : "chat-panel-active"}`}>
        <header className="chat-header">
          <div className="chat-header-main">
            {isMobileViewport ? (
              <button
                type="button"
                className="ghost-icon-button mobile-sidebar-toggle"
                aria-label={mobileSidebarOpen ? "Close navigation" : "Open navigation"}
                aria-expanded={mobileSidebarOpen}
                onClick={() => setMobileSidebarOpen((current) => !current)}
              >
                <IconSidebarToggle />
              </button>
            ) : null}

            {activeConversation ? (
              <div className="chat-header-menu" data-chat-action-menu>
                <button
                  type="button"
                  className={`chat-header-title-button ${headerMenuOpen ? "chat-header-title-button-open" : ""}`}
                  aria-label={`Open menu for ${activeConversation.title}`}
                  aria-expanded={headerMenuOpen}
                  onClick={() => {
                    setOpenConversationMenuId(null);
                    setHeaderMenuOpen((current) => !current);
                  }}
                >
                  <span className="chat-header-title">{activeConversation.title}</span>
                  <span className="chat-header-title-divider" aria-hidden="true" />
                  <span className={`chat-header-title-chevron ${headerMenuOpen ? "chat-header-title-chevron-open" : ""}`} aria-hidden="true">
                    <IconChevron />
                  </span>
                </button>

                {headerMenuOpen ? (
                  <div className="chat-action-menu">
                    <button
                      type="button"
                      className="chat-action-menu-item chat-action-menu-item-danger"
                      onClick={() => {
                        void handleDeleteConversation(activeConversation.id);
                      }}
                      disabled={deletingConversationId === activeConversation.id}
                    >
                      {deletingConversationId === activeConversation.id ? "Deleting…" : "Delete chat"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="chat-header-title">Loading conversation</div>
            )}
          </div>
        </header>

        <div className="chat-stage">
          {isLandingState ? (
            <section className="chat-landing">
              {errorMessage ? <div className="error-banner error-banner-landing">{errorMessage}</div> : null}
              <div className="chat-landing-badge">AI chat</div>
              <div className="chat-landing-title">
                <span className="chat-landing-title-icon">
                  <IconSpark />
                </span>
                <h1>What shall we think through?</h1>
              </div>
              <p className="chat-landing-copy">
                Ask questions, upload files, research ideas, and move from planning to execution in one conversation.
              </p>
              <div className="chat-landing-suggestions" aria-label="Suggested prompts">
                {landingSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chat-landing-chip"
                    onClick={() => {
                      setComposerValue(suggestion);
                      window.requestAnimationFrame(() => {
                        composerInputRef.current?.focus();
                        resizeComposer(composerInputRef.current);
                      });
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="chat-transcript" ref={transcriptRef}>
              <div className="chat-transcript-inner">
                {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

                {runs.map((run) => (
                  <RunThread
                    key={run.id}
                    userPrompt={run.userPrompt}
                    attachments={run.attachments}
                    events={run.events}
                    finalText={run.finalText}
                    createdAt={run.createdAt}
                  />
                ))}

                {liveRun ? (
                  <RunThread
                    userPrompt={liveRun.userPrompt}
                    attachments={liveRun.attachments}
                    events={liveRun.events}
                    finalText={liveRun.partialText || null}
                    createdAt={new Date().toISOString()}
                    isLive
                  />
                ) : null}
              </div>
            </div>
          )}

        <footer
          className={[
            "composer-panel",
            isLandingState ? "composer-panel-landing" : "composer-panel-docked",
            animateComposerDock ? "composer-panel-animate-dock" : "",
          ].join(" ")}
        >
          <div className="composer-shell">
            {composerAttachments.length ? (
              <div className="composer-attachments">
                {composerAttachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={() => setComposerAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
                  />
                ))}
              </div>
            ) : null}

            <textarea
              ref={composerInputRef}
              className="composer-input"
              placeholder={isLandingState ? "How can I help today?" : "Reply..."}
              value={composerValue}
              onChange={(event) => {
                setComposerValue(event.target.value);
                resizeComposer(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={1}
            />

            <div className="composer-footer">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept="image/*,.pdf,.txt,.md,.json"
                onChange={(event) => {
                  void handleUpload(event.target.files);
                }}
              />

              <button
                type="button"
                className="composer-add-button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload a file"
              >
                <IconPlus />
              </button>

              <div className="composer-footer-actions">
                <div className="composer-model-menu" data-chat-action-menu>
                  <button
                    type="button"
                    className="composer-model-button"
                    aria-label="Select model"
                    aria-expanded={modelMenuOpen}
                    ref={modelButtonRef}
                    onClick={() => setModelMenuOpen((current) => !current)}
                  >
                    <span>{formatModelDisplayName(selectedMainModelId)}</span>
                    <IconChevron />
                  </button>

                  {modelMenuOpen && catalog ? (
                    <ComposerModelMenuPortal
                      anchor={modelButtonRef.current}
                      models={catalog.availableMainModels}
                      selectedModelId={selectedMainModelId}
                      isUpdating={isUpdatingModel}
                      onSelect={(modelId) => {
                        void handleSelectMainModel(modelId);
                      }}
                    />
                  ) : null}
                </div>

                <button
                  type="button"
                  className="composer-send-button"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={!composerValue.trim() || isSending}
                  aria-label={isSending ? "Streaming response" : "Send message"}
                >
                  <IconArrowUp />
                </button>
              </div>
            </div>
          </div>

          <div className="composer-disclaimer">AI can make mistakes. Please double-check responses.</div>
        </footer>
        </div>
      </main>

      {searchModalOpen ? (
        <div className="search-modal-overlay" onClick={() => setSearchModalOpen(false)}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="search-modal-header">
              <IconSearch />
              <input
                type="text"
                className="search-modal-input"
                placeholder="Search chats"
                autoFocus
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
              />
              <button type="button" className="ghost-icon-button search-modal-close" onClick={() => { setSearchModalOpen(false); setSidebarQuery(""); }}>
                <IconClose />
              </button>
            </div>
            <div className="search-modal-results">
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={`search-modal-item ${conversation.id === activeConversationId ? "search-modal-item-active" : ""}`}
                  onClick={() => {
                    setSearchModalOpen(false);
                    setSidebarQuery("");
                    void selectConversation(conversation.id).catch(() => {});
                  }}
                >
                  <span className="search-modal-item-title">{conversation.title}</span>
                </button>
              ))}
              {filteredConversations.length === 0 ? (
                <div className="search-modal-empty">No chats found</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
