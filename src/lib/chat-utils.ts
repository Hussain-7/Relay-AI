import type { AttachmentDto, TimelineEventEnvelope } from "@/lib/contracts";

export type LiveRunState = {
  runId: string | null;
  userPrompt: string;
  attachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  partialText: string;
  status: "running" | "failed";
  error: string | null;
};

export type ToolTimelineEntry = {
  id: string;
  kind: "tool";
  title: string;
  runtime: string | null;
  status: "running" | "completed" | "failed";
  input: string;
  output: string;
};

export type RenderTimelineEntry =
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
    "conversation.updated",
    "run.started",
    "run.completed",
    "assistant.message.completed",
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
