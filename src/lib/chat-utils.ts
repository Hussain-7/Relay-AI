import type { AttachmentDto, TimelineEventEnvelope } from "@/lib/contracts";

export type LiveRunState = {
  runId: string | null;
  userPrompt: string;
  attachments: AttachmentDto[];
  outputAttachments: AttachmentDto[];
  events: TimelineEventEnvelope[];
  partialText: string;
  status: "running" | "completed" | "failed" | "interrupted";
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

// ─── Segment grouping (interleaved text + timeline rendering) ──────────────

export type TextSegment = { kind: "text"; id: string; text: string };
export type TimelineSegment = { kind: "timeline"; id: string; entries: RenderTimelineEntry[] };
export type RunSegment = TextSegment | TimelineSegment;

/**
 * Groups a flat array of timeline entries into alternating text and timeline segments.
 * - `intermediate` entries → TextSegment (consecutive ones merge, joined with \n\n)
 * - All other kinds → TimelineSegment (consecutive non-text entries group together)
 */
export function groupEntriesIntoSegments(entries: RenderTimelineEntry[]): RunSegment[] {
  const segments: RunSegment[] = [];
  let currentTimeline: RenderTimelineEntry[] = [];
  let currentText: { id: string; text: string }[] = [];

  const flushText = () => {
    if (currentText.length > 0) {
      segments.push({
        kind: "text",
        id: currentText[0].id,
        text: currentText.map((t) => t.text).join("\n\n"),
      });
      currentText = [];
    }
  };

  const flushTimeline = () => {
    if (currentTimeline.length > 0) {
      segments.push({
        kind: "timeline",
        id: currentTimeline[0].id,
        entries: currentTimeline,
      });
      currentTimeline = [];
    }
  };

  for (const entry of entries) {
    if (entry.kind === "intermediate") {
      flushTimeline();
      currentText.push({ id: entry.id, text: entry.text });
    } else {
      flushText();
      currentTimeline.push(entry);
    }
  }

  // Flush remaining
  flushTimeline();
  flushText();

  return segments;
}

// ─── Formatting helpers ────────────────────────────────────────────────────

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

function summarizeToolAction(name: string, input?: string, status?: ToolTimelineEntry["status"]) {
  const running = status === "running";
  // Try to extract contextual info from tool input for richer summaries
  const context = input ? extractToolContext(name, input, running) : null;
  if (context) return context;

  switch (name) {
    case "web_search":
      return running ? "Searching the web" : "Searched the web";
    case "web_fetch":
      return running ? "Fetching source pages" : "Fetched source pages";
    case "memory":
      return running ? "Checking saved memory" : "Checked saved memory";
    case "code_execution":
      return running ? "Writing code" : "Ran code";
    case "image_generation":
      return running ? "Generating an image" : "Generated an image";
    case "text_editor":
      return running ? "Editing a file" : "Edited a file";
    case "tool_search":
    case "tool_search_tool_regex":
      return running ? "Looking for tools" : "Looked for tools";
    default:
      return running ? `Using ${formatToolDisplayName(name)}` : `Used ${formatToolDisplayName(name)}`;
  }
}

/**
 * Extract a contextual one-liner from tool input to make summaries dynamic.
 * When `running` is true, uses present-progressive tense ("Searching for X").
 * When false, uses past tense ("Searched for X").
 * Returns null if no meaningful context can be extracted.
 */
function extractToolContext(toolName: string, input: string, running?: boolean): string | null {
  try {
    const parsed = JSON.parse(input);
    switch (toolName) {
      case "web_search": {
        const query = parsed.query ?? parsed.q;
        if (typeof query === "string" && query.trim()) {
          const q = truncate(query.trim(), 50);
          return running ? `Searching for "${q}"` : `Searched for "${q}"`;
        }
        return null;
      }
      case "web_fetch": {
        const url = parsed.url;
        if (typeof url === "string" && url.trim()) {
          try {
            const host = new URL(url).hostname.replace(/^www\./, "");
            return running ? `Fetching from ${host}` : `Fetched content from ${host}`;
          } catch {
            return null;
          }
        }
        return null;
      }
      case "memory": {
        const command = parsed.command;
        if (command === "read") return running ? "Reading saved memory" : "Read saved memory";
        if (command === "write") return running ? "Saving to memory" : "Saved to memory";
        if (command === "ls" || command === "list") return running ? "Browsing saved memory" : "Browsed saved memory";
        return null;
      }
      case "code_execution": {
        if (running) return "Writing code";
        return null;
      }
      case "image_generation": {
        const prompt = parsed.prompt ?? parsed.description;
        if (typeof prompt === "string" && prompt.trim()) {
          const p = truncate(prompt.trim(), 50);
          return running ? `Generating "${p}"` : `Generated "${p}"`;
        }
        return null;
      }
      case "text_editor": {
        const command = parsed.command;
        const path = typeof parsed.path === "string" ? parsed.path : "";
        // Skill files: /skills/<name>/SKILL.md
        const skillMatch = path.match(/\/skills\/([^/]+)\//);
        if (skillMatch) {
          const skillName = skillMatch[1]!.replace(/[-_]+/g, " ");
          return running ? `Reading ${skillName} skill` : `Loaded ${skillName} skill`;
        }
        // General file operations
        const filename = path.split("/").pop() ?? path;
        if (!filename) return null;
        if (command === "view") return running ? `Reading ${truncate(filename, 40)}` : `Read ${truncate(filename, 40)}`;
        if (command === "create")
          return running ? `Creating ${truncate(filename, 40)}` : `Created ${truncate(filename, 40)}`;
        if (command === "str_replace")
          return running ? `Editing ${truncate(filename, 40)}` : `Edited ${truncate(filename, 40)}`;
        if (command === "insert")
          return running ? `Writing to ${truncate(filename, 40)}` : `Wrote to ${truncate(filename, 40)}`;
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * Extract a concise status phrase from thinking text.
 * Picks the last meaningful sentence and cleans it up for display.
 */
function extractThinkingSummary(thinkingText: string): string | null {
  if (!thinkingText || thinkingText.length < 10) return null;

  // Take the last ~500 chars to find the most recent thought
  const tail = thinkingText.slice(-500).trim();

  // Split into sentences (period, exclamation, question mark, or newline boundaries)
  const sentences = tail
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length < 120);

  if (sentences.length === 0) return null;

  // Take the last complete sentence
  let sentence = sentences[sentences.length - 1]!;

  // Clean up: remove leading filler phrases
  sentence = sentence
    .replace(/^(okay|ok|so|well|now|alright|right|hmm|let me|i('ll| will| should| need to| think| can))\s*/i, "")
    .replace(/^(let's|we should|we need to|we can|i'm going to)\s*/i, "")
    .trim();

  if (sentence.length < 8) return null;

  // Capitalize first letter, remove trailing period for cleaner display
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  sentence = sentence.replace(/\.$/, "");

  return truncate(sentence, 80);
}

/**
 * Convert a thinking summary to past tense for completed runs.
 * Simple heuristic: if it starts with a gerund (-ing), past-tense-ify it.
 */
function toCompletedForm(summary: string): string {
  // "Crafting X" → "Crafted X", "Designing X" → "Designed X"
  const match = summary.match(/^(\w+?)(ing)\b(.*)/);
  if (match) {
    const stem = match[1]!;
    const rest = match[3] ?? "";
    // Simple past tense: remove trailing consonant doubling artifacts
    // "Crafting" → "Craft" + "ed" = "Crafted"
    // "Running" → "Runn" → "Ran" (skip complex irregulars)
    const pastStem = stem.endsWith(stem.charAt(stem.length - 1)) ? stem.slice(0, -1) : stem;
    return `${pastStem}ed${rest}`;
  }
  return summary;
}

export function buildActivitySummary(entries: RenderTimelineEntry[], isLive: boolean) {
  // --- Dynamic thinking summary ---
  // Find the latest thinking entry and extract a contextual phrase
  const thinkingEntries = entries.filter((e) => e.kind === "thinking");
  const latestThinking = thinkingEntries[thinkingEntries.length - 1];
  const thinkingSummary = latestThinking?.kind === "thinking" ? extractThinkingSummary(latestThinking.text) : null;

  // --- Contextual tool summaries ---
  // Show only the most recent tool action — this is a live status indicator, not a history log
  const toolEntries = entries.filter((entry): entry is ToolTimelineEntry => entry.kind === "tool");
  if (toolEntries.length > 0) {
    const latest = toolEntries[toolEntries.length - 1]!;
    return summarizeToolAction(latest.title, latest.input, latest.status);
  }

  // If we have a thinking summary, show the dynamic contextual text
  if (thinkingSummary) {
    return isLive ? thinkingSummary : toCompletedForm(thinkingSummary);
  }

  // Fallback for thinking without extractable summary
  if (thinkingEntries.length > 0) {
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
              const inputSummary =
                typeof event.payload?.inputSummary === "string"
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
                  typeof event.payload?.resultContent === "string" ? event.payload.resultContent : null;
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
              const inputSummary =
                typeof event.payload?.inputSummary === "string" ? event.payload.inputSummary : candidateName;
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
        const resolvedStatus =
          event.payload?.status === "APPROVED"
            ? ("answered" as const)
            : event.payload?.status === "REJECTED" &&
                (event.payload?.response as Record<string, unknown> | null)?.reason === "timeout"
              ? ("timeout" as const)
              : ("rejected" as const);
        const resolvedResponse = (event.payload?.response as Record<string, unknown> | null) ?? null;
        // Find and update the matching pending approval entry
        if (resolvedApprovalId) {
          const existing = entries.find((e) => e.kind === "approval" && e.approvalId === resolvedApprovalId);
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
  if (["HTML", "HTM"].includes(ext)) return "HTML";
  if (["DOC", "DOCX"].includes(ext)) return "DOC";
  if (["XLS", "XLSX"].includes(ext)) return "XLS";
  if (["TXT", "MD", "JSON", "CSV"].includes(ext)) return ext;
  return "FILE";
}

export function isHtmlAttachment(a: AttachmentDto): boolean {
  return a.mediaType === "text/html" || /\.html?$/i.test(a.filename);
}

export function formatRelativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000,
  );

  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
