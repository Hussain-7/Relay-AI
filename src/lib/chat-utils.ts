import type { AttachmentDto, TimelineEventEnvelope } from "@/lib/contracts";

export type LiveRunState = {
  runId: string | null;
  userPrompt: string;
  attachments: AttachmentDto[];
  outputAttachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  partialText: string;
  status: "running" | "failed" | "interrupted";
  error: string | null;
};

export type ToolLogEntry = {
  id: string;
  message: string;
  kind?: "thinking" | "text" | "subagent" | "tool_result" | "diff";
  /** Expandable detail content (tool output, diff body) */
  detail?: string | null;
  /** Whether this tool result was an error */
  isError?: boolean;
};

export type ToolTimelineEntry = {
  id: string;
  kind: "tool";
  title: string;
  runtime: string | null;
  status: "running" | "completed" | "failed";
  input: string;
  output: string;
  logs: ToolLogEntry[];
};

export type RenderTimelineEntry =
  | {
      id: string;
      kind: "thinking";
      text: string;
    }
  | {
      id: string;
      kind: "intermediate";
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
      approvalId: string;
      question: string;
      options: string[] | null;
      allowFreeform: boolean;
      status: "pending" | "answered" | "rejected" | "timeout";
      response: Record<string, unknown> | null;
      runId: string;
    }
  | {
      id: string;
      kind: "action";
      title: string;
      description: string;
      actionLabel: string;
      actionUrl: string;
    };

export function formatShortTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function previewText(value: string | null) {
  if (!value) {
    return "No reply yet";
  }

  return value.length > 82 ? `${value.slice(0, 82)}…` : value;
}

export function stringifyUnknown(value: unknown) {
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

export function formatModelDisplayName(model: string | null | undefined) {
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

export function formatToolDisplayName(name: string) {
  return name
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatToolRuntimeLabel(runtime: string | null) {
  switch (runtime) {
    case "anthropic_server":
      return "Built-in";
    case "anthropic_client":
      return "Connected";
    case "coding_agent":
      return "Coding agent";
    default:
      return runtime ? runtime.replaceAll("_", " ") : null;
  }
}

export function formatToolStatusLabel(status: ToolTimelineEntry["status"]) {
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
    case "image_generation":
      return "Generated an image";
    case "tool_search":
    case "tool_search_tool_regex":
      return "Looked for tools";
    default:
      return `Used ${formatToolDisplayName(name)}`;
  }
}

export function buildActivitySummary(entries: RenderTimelineEntry[], isLive: boolean) {
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

  if (entries.some((entry) => entry.kind === "approval" && entry.status === "pending")) {
    return "Waiting for your response";
  }

  if (entries.some((entry) => entry.kind === "approval")) {
    return "Handled a decision";
  }

  if (entries.some((entry) => entry.kind === "system")) {
    return "View run details";
  }

  return isLive ? "Working on it" : "View activity";
}

export function getToolDetailLabel(entry: ToolTimelineEntry) {
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

export function normalizeApiErrorMessage(message: string) {
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

export function resizeComposer(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

const CODING_TOOL_NAMES = new Set(["coding_agent_sandbox"]);

/** Find the most recent coding session tool entry (still running or completed). */
function findParentCodingTool(entries: RenderTimelineEntry[]): ToolTimelineEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === "tool" && CODING_TOOL_NAMES.has(entry.title)) {
      return entry;
    }
  }
  return null;
}

export function buildTimelineEntries(events: TimelineEventEnvelope[]) {
  const entries: RenderTimelineEntry[] = [];
  const toolEntries = new Map<string, ToolTimelineEntry>();
  let thinkingEntry: Extract<RenderTimelineEntry, { kind: "thinking" }> | null = null;

  const flushThinking = () => {
    if (thinkingEntry?.text.trim()) {
      entries.push(thinkingEntry);
    }

    thinkingEntry = null;
  };

  const nonFlushingTypes = new Set([
    "assistant.thinking.delta",
    "assistant.thinking.completed",
    "conversation.updated",
    "run.started",
    "run.completed",
    "assistant.message.completed",
    "coding.agent.thinking",
    "coding.agent.text",
    "coding.agent.task.started",
    "coding.agent.task.progress",
    "coding.agent.task.completed",
    "coding.agent.usage",
    "coding.agent.diff",
  ]);

  for (const event of events) {
    if (!nonFlushingTypes.has(event.type)) {
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
      case "assistant.thinking.completed": {
        // Consolidated thinking event (persisted to DB, used on reload)
        // Only create if no delta-based thinking entry exists yet
        if (!thinkingEntry) {
          const text = typeof event.payload?.text === "string" ? event.payload.text : "";
          if (text.trim()) {
            thinkingEntry = {
              id: `thinking-${event.id}`,
              kind: "thinking",
              text,
            };
          }
        }
        break;
      }
      case "assistant.text.intermediate": {
        const intermediateText = typeof event.payload?.text === "string" ? event.payload.text : "";
        if (intermediateText.trim()) {
          // Deduplicate: skip if the previous entry is an identical intermediate
          const prevEntry = entries[entries.length - 1];
          if (prevEntry?.kind === "intermediate" && prevEntry.text === intermediateText) {
            break;
          }
          entries.push({
            id: `intermediate-${event.id}`,
            kind: "intermediate",
            text: intermediateText,
          });
        }
        break;
      }
      case "tool.call.started": {
        const key =
          (typeof event.payload?.toolUseId === "string" && event.payload.toolUseId) ||
          `${String(event.payload?.toolName ?? "tool")}-${event.id}`;
        // Avoid duplicates if the same tool use ID appears multiple times
        if (!toolEntries.has(key)) {
          const isSubTool = event.source === "coding_agent";
          const toolEntry: ToolTimelineEntry = {
            id: key,
            kind: "tool",
            title: String(event.payload?.toolName ?? "Tool call"),
            runtime: typeof event.payload?.toolRuntime === "string" ? event.payload.toolRuntime : null,
            status: "running",
            input: stringifyUnknown(event.payload?.input),
            output: "",
            logs: [],
          };
          toolEntries.set(key, toolEntry);
          // Coding agent sub-tools nest under their parent tool as logs
          if (isSubTool) {
            const parentTool = findParentCodingTool(entries);
            if (parentTool) {
              const inputSummary = typeof event.payload?.inputSummary === "string"
                ? event.payload.inputSummary
                : String(event.payload?.toolName ?? "Tool");
              parentTool.logs.push({
                id: key,
                message: inputSummary,
              });
            } else {
              entries.push(toolEntry);
            }
          } else {
            entries.push(toolEntry);
          }
        }
        break;
      }
      case "tool.call.input.delta": {
        // Try toolUseId first, then fall back to matching by tool name or last entry
        const toolUseId = typeof event.payload?.toolUseId === "string" ? event.payload.toolUseId : null;
        const key =
          (toolUseId && toolEntries.has(toolUseId) && toolUseId) ||
          Array.from(toolEntries.values())
            .reverse()
            .find((entry) => entry.status === "running")?.id ||
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
        const completedInput = stringifyUnknown(event.payload?.input);
        const completedOutput =
          stringifyUnknown(event.payload?.result) ||
          stringifyUnknown(event.payload?.resultPreview) ||
          stringifyUnknown(event.payload?.error);
        const isSubTool = event.source === "coding_agent";
        const existing = toolEntries.get(key);
        if (existing) {
          existing.status = event.type === "tool.call.completed" ? "completed" : "failed";
          existing.output = completedOutput;
          // Backfill input if the started event had empty/stub input (e.g. after reload).
          // Streaming tool_use blocks arrive with input: {} which persists as "{}".
          const existingInputEmpty = !existing.input.trim() || existing.input.trim() === "{}";
          const completedInputUseful = completedInput.trim() && completedInput.trim() !== "{}";
          if (existingInputEmpty && completedInputUseful) {
            existing.input = completedInput;
          }
          // Update parent tool log for coding agent sub-tools
          if (isSubTool) {
            const parentTool = findParentCodingTool(entries);
            if (parentTool) {
              const logEntry = parentTool.logs.find((l) => l.id === key);
              if (logEntry) {
                // Append status to the existing inputSummary-based message
                const statusSuffix = event.type === "tool.call.completed" ? " — done" : " — failed";
                logEntry.message = logEntry.message + statusSuffix;
                // Attach tool result content for expandable detail
                const resultContent =
                  typeof event.payload?.resultContent === "string"
                    ? event.payload.resultContent
                    : null;
                if (resultContent) {
                  logEntry.kind = "tool_result";
                  logEntry.detail = resultContent;
                  logEntry.isError = event.payload?.isError === true;
                }
              }
            }
          }
        } else {
          const toolEntry: ToolTimelineEntry = {
            id: key,
            kind: "tool",
            title: candidateName,
            runtime: typeof event.payload?.toolRuntime === "string" ? event.payload.toolRuntime : null,
            status: event.type === "tool.call.completed" ? "completed" : "failed",
            input: completedInput,
            output: completedOutput,
            logs: [],
          };
          toolEntries.set(key, toolEntry);
          // Coding agent sub-tools nest under their parent tool as logs
          if (isSubTool) {
            const parentTool = findParentCodingTool(entries);
            if (parentTool) {
              const inputSummary = typeof event.payload?.inputSummary === "string"
                ? event.payload.inputSummary
                : candidateName;
              const statusSuffix = event.type === "tool.call.completed" ? " — done" : " — failed";
              parentTool.logs.push({
                id: key,
                message: inputSummary + statusSuffix,
              });
            } else {
              entries.push(toolEntry);
            }
          } else {
            entries.push(toolEntry);
          }
        }
        break;
      }
      case "coding.session.created":
      case "coding.session.ready":
      case "coding.session.paused":
      case "coding.session.resumed":
      case "coding.agent.running": {
        const msg = typeof event.payload?.message === "string" ? event.payload.message : null;
        const logMessage = msg ?? event.type.replaceAll(".", " ");
        // Nest under the parent coding tool if one exists
        const parentTool = findParentCodingTool(entries);
        if (parentTool) {
          parentTool.logs.push({ id: event.id, message: logMessage });
        } else {
          entries.push({
            id: event.id,
            kind: "system",
            title: logMessage,
            description: msg ? "" : stringifyUnknown(event.payload),
          });
        }
        break;
      }
      case "coding.agent.thinking": {
        const text = typeof event.payload?.text === "string" ? event.payload.text : "";
        const preview = text.length > 800 ? text.slice(0, 800) + "…" : text;
        if (preview.trim()) {
          const parentTool = findParentCodingTool(entries);
          if (parentTool) {
            parentTool.logs.push({
              id: event.id,
              message: preview,
              kind: "thinking",
              detail: text.length > 800 ? text : null,
            });
          }
        }
        break;
      }
      case "coding.agent.text": {
        const text = typeof event.payload?.text === "string" ? event.payload.text : "";
        const preview = text.length > 1000 ? text.slice(0, 1000) + "…" : text;
        if (preview.trim()) {
          const parentTool = findParentCodingTool(entries);
          if (parentTool) {
            parentTool.logs.push({
              id: event.id,
              message: preview,
              kind: "text",
              detail: text.length > 1000 ? text : null,
            });
          }
        }
        break;
      }
      case "coding.agent.task.started": {
        const desc = typeof event.payload?.description === "string" ? event.payload.description : "task";
        const parentTool = findParentCodingTool(entries);
        if (parentTool) {
          parentTool.logs.push({ id: event.id, message: `Subagent: ${desc}`, kind: "subagent" });
        }
        break;
      }
      case "coding.agent.task.progress": {
        const desc = typeof event.payload?.description === "string" ? event.payload.description : "";
        if (desc.trim()) {
          const parentTool = findParentCodingTool(entries);
          if (parentTool) {
            parentTool.logs.push({ id: event.id, message: desc, kind: "subagent" });
          }
        }
        break;
      }
      case "coding.agent.task.completed": {
        const desc = typeof event.payload?.description === "string" ? event.payload.description : "task";
        const usage = event.payload?.usage as { total_tokens?: number; duration_ms?: number } | undefined;
        const stats = usage
          ? ` (${usage.total_tokens ?? "?"} tokens, ${Math.round((usage.duration_ms ?? 0) / 1000)}s)`
          : "";
        const parentTool = findParentCodingTool(entries);
        if (parentTool) {
          parentTool.logs.push({ id: event.id, message: `Subagent done: ${desc}${stats}`, kind: "subagent" });
        }
        break;
      }
      case "coding.agent.usage": {
        // Cost is shown next to the copy button, not in logs
        break;
      }
      case "coding.agent.diff": {
        const diff = typeof event.payload?.diff === "string" ? event.payload.diff : "";
        const diffStat = typeof event.payload?.diffStat === "string" ? event.payload.diffStat : "";
        if (diff.trim()) {
          const parentTool = findParentCodingTool(entries);
          if (parentTool) {
            parentTool.logs.push({
              id: event.id,
              message: diffStat || "Files changed",
              kind: "diff",
              detail: diff,
            });
          }
        }
        break;
      }
      case "approval.requested": {
        const approvalId = typeof event.payload?.approvalId === "string" ? event.payload.approvalId : event.id;
        const question = typeof event.payload?.question === "string" ? event.payload.question : "Approval requested";
        const options = Array.isArray(event.payload?.options) ? (event.payload.options as string[]) : null;
        const allowFreeform = typeof event.payload?.allowFreeform === "boolean" ? event.payload.allowFreeform : true;
        entries.push({
          id: `approval-${approvalId}`,
          kind: "approval",
          approvalId,
          question,
          options,
          allowFreeform,
          status: "pending",
          response: null,
          runId: event.runId,
        });
        break;
      }
      case "approval.resolved": {
        const resolvedApprovalId = typeof event.payload?.approvalId === "string" ? event.payload.approvalId : null;
        const resolvedStatus = event.payload?.status === "APPROVED" ? "answered" as const
          : event.payload?.status === "REJECTED" && (event.payload?.response as Record<string, unknown> | null)?.reason === "timeout" ? "timeout" as const
          : "rejected" as const;
        const resolvedResponse = (event.payload?.response as Record<string, unknown> | null) ?? null;
        // Find and update the matching pending approval entry
        if (resolvedApprovalId) {
          const existing = entries.find(
            (e) => e.kind === "approval" && e.approvalId === resolvedApprovalId,
          );
          if (existing && existing.kind === "approval") {
            existing.status = resolvedStatus;
            existing.response = resolvedResponse;
            break;
          }
        }
        // Fallback: create a standalone resolved entry (shouldn't normally happen)
        entries.push({
          id: `approval-resolved-${event.id}`,
          kind: "approval",
          approvalId: resolvedApprovalId ?? event.id,
          question: "Question",
          options: null,
          allowFreeform: true,
          status: resolvedStatus,
          response: resolvedResponse,
          runId: event.runId,
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

export function getFileTypeBadge(attachment: AttachmentDto) {
  if (attachment.kind === "PDF") return "PDF";
  if (attachment.kind === "IMAGE") return "IMG";
  const ext = attachment.filename.split(".").pop()?.toUpperCase() ?? "";
  if (["DOC", "DOCX"].includes(ext)) return "DOC";
  if (["XLS", "XLSX"].includes(ext)) return "XLS";
  if (["TXT", "MD", "JSON", "CSV"].includes(ext)) return ext;
  return "FILE";
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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

export const landingSuggestions = [
  "Plan a product MVP",
  "Research a technical topic",
  "Review an architecture idea",
  "Map out a coding task",
];
