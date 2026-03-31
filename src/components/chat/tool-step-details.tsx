"use client";

import { useState } from "react";
import { DiffView } from "@/components/chat/diff-view";
import { IconChevron } from "@/components/icons";
import type { ToolLogEntry, ToolTimelineEntry } from "@/lib/chat-utils";
import { getToolDetailLabel } from "@/lib/chat-utils";

function LogEntryExpandable({ log }: { log: ToolLogEntry }) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const hasDetail = Boolean(log.detail);

  const bulletColor =
    log.kind === "thinking"
      ? "bg-[rgba(245,240,232,0.2)]"
      : log.kind === "text"
        ? "bg-[rgba(212,190,160,0.4)]"
        : log.kind === "subagent"
          ? "bg-[rgba(140,180,220,0.45)]"
          : log.kind === "diff"
            ? "bg-[rgba(180,160,220,0.5)]"
            : log.kind === "tool_result" && log.isError
              ? "bg-[rgba(220,120,120,0.5)]"
              : "bg-[rgba(122,168,148,0.5)]";

  const textColor =
    log.kind === "thinking"
      ? "text-[rgba(245,240,232,0.42)] italic"
      : log.kind === "text"
        ? "text-[rgba(212,190,160,0.68)]"
        : log.kind === "subagent"
          ? "text-[rgba(180,200,220,0.68)]"
          : log.kind === "diff"
            ? "text-[rgba(180,160,220,0.72)]"
            : "text-[rgba(245,240,232,0.62)]";

  const toggleLabel =
    log.kind === "diff" || log.kind === "tool_result"
      ? isDetailOpen
        ? "hide"
        : "show"
      : isDetailOpen
        ? "less"
        : "more";

  return (
    <li className={`flex flex-col gap-1 text-[0.8rem] leading-[1.45] ${textColor}`}>
      <div className="flex items-start gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 mt-[5px] ${bulletColor}`} aria-hidden="true" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          {log.message}
          {hasDetail ? (
            <button
              type="button"
              className="ml-2 text-[0.72rem] text-[rgba(245,240,232,0.4)] hover:text-[rgba(245,240,232,0.7)] bg-transparent border-0 cursor-pointer p-0"
              onClick={() => setIsDetailOpen((v) => !v)}
            >
              [{toggleLabel}]
            </button>
          ) : null}
        </span>
      </div>
      {isDetailOpen && log.detail ? (
        <div className="ml-4 mt-1">
          {log.kind === "diff" ? (
            <DiffView diff={log.detail} />
          ) : log.kind === "tool_result" ? (
            <pre
              className={`overflow-auto m-0 rounded-[10px] bg-[rgba(8,8,8,0.45)] px-3 py-2.5 text-[0.75rem] leading-[1.5] whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-h-[300px] font-mono border ${
                log.isError
                  ? "border-[rgba(220,120,120,0.2)] text-[rgba(220,140,140,0.85)]"
                  : "border-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.75)]"
              }`}
            >
              {log.detail}
            </pre>
          ) : (
            <div className="text-[0.78rem] leading-[1.5] text-[rgba(245,240,232,0.55)] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {log.detail}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** For code_execution / text_editor tools, extract the meaningful content from raw JSON input. */
function formatToolInput(title: string, rawInput: string): { label: string; code: string } | null {
  try {
    const parsed = JSON.parse(rawInput);

    if (title === "code_execution" && typeof parsed.code === "string") {
      return { label: parsed.language ?? "python", code: parsed.code };
    }

    if (title === "text_editor") {
      const cmd = parsed.command as string | undefined;
      const path = parsed.path as string | undefined;
      if (cmd === "view" && path) return { label: `view ${path}`, code: "" };
      if (cmd === "create" && path && typeof parsed.file_text === "string") {
        return { label: `create ${path}`, code: parsed.file_text };
      }
      if (cmd === "str_replace" && path) {
        const old = parsed.old_str as string | undefined;
        const replacement = parsed.new_str as string | undefined;
        if (old && replacement) {
          return { label: `edit ${path}`, code: `- ${old}\n+ ${replacement}` };
        }
      }
      if (cmd === "insert" && path && typeof parsed.insert_line === "number" && typeof parsed.new_str === "string") {
        return { label: `insert at ${path}:${parsed.insert_line}`, code: parsed.new_str };
      }
    }

    if (title === "web_search" && typeof parsed.query === "string") {
      return { label: "query", code: parsed.query };
    }

    if (title === "web_fetch" && typeof parsed.url === "string") {
      return { label: "url", code: parsed.url };
    }
  } catch {
    // Not JSON — return null to use raw display
  }
  return null;
}

function ToolInputSection({ entry }: { entry: ToolTimelineEntry }) {
  const formatted = formatToolInput(entry.title, entry.input);

  if (formatted?.code) {
    return (
      <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">Request</span>
          <span className="text-[rgba(245,240,232,0.3)] text-[0.7rem] font-mono">{formatted.label}</span>
        </div>
        <pre className="overflow-auto m-0 rounded-[16px] bg-[rgba(8,8,8,0.5)] px-4 py-3 text-[rgba(255,255,255,0.88)] text-[0.78rem] leading-[1.6] whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono max-h-[400px] border border-[rgba(255,255,255,0.05)]">
          <code>{formatted.code}</code>
        </pre>
      </section>
    );
  }

  if (formatted && !formatted.code) {
    // Simple display for view/search commands with no code body
    return (
      <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
        <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">Request</div>
        <div className="px-3.5 py-2.5 text-[rgba(255,255,255,0.75)] text-[0.82rem] font-mono">{formatted.label}</div>
      </section>
    );
  }

  // Fallback: raw JSON
  return (
    <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
      <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">Request</div>
      <pre
        className="overflow-auto m-0 rounded-[16px] bg-[rgba(8,8,8,0.4)] px-3.5 py-3 text-[rgba(255,255,255,0.82)] text-[0.78rem] leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
        aria-label={`${entry.title} input`}
      >
        {entry.input}
      </pre>
    </section>
  );
}

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
        <span
          className={`inline-grid place-items-center transition-transform duration-[180ms] ease-linear ${isExpanded ? "rotate-0" : "-rotate-90"}`}
          aria-hidden="true"
        >
          <IconChevron />
        </span>
      </button>

      {isExpanded ? (
        <div className="grid gap-3 mt-3 min-w-0">
          {hasInput ? <ToolInputSection entry={entry} /> : null}
          {hasLogs ? (
            <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
              <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">
                Processing
              </div>
              <ol className="m-0 p-0 list-none grid gap-1.5 overflow-y-auto pr-1">
                {entry.logs.map((log) => (
                  <LogEntryExpandable key={log.id} log={log} />
                ))}
              </ol>
            </section>
          ) : null}
          {hasOutput ? (
            <section className="border border-[rgba(255,255,255,0.08)] rounded-[18px] bg-[rgba(255,255,255,0.03)] p-3 min-w-0 overflow-hidden">
              <div className="mb-2 text-[rgba(245,240,232,0.5)] text-[0.72rem] tracking-[0.12em] uppercase">
                Response
              </div>
              <pre
                className="overflow-auto m-0 rounded-[16px] bg-[rgba(8,8,8,0.4)] px-3.5 py-3 text-[rgba(255,255,255,0.82)] text-[0.78rem] leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere] border border-[rgba(122,168,148,0.18)]"
                aria-label={`${entry.title} output`}
              >
                {entry.output}
              </pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
