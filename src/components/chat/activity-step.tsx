import type { RenderTimelineEntry } from "@/lib/chat-utils";
import { formatToolDisplayName, formatToolStatusLabel, formatToolRuntimeLabel } from "@/lib/chat-utils";
import { IconThinking, IconTool, IconDone, IconInfo } from "@/components/icons";
import { ToolStepDetails } from "@/components/chat/tool-step-details";
import { ApprovalCard } from "@/components/chat/approval-card";

export function ActivityStep({
  entry,
  isLast,
}: {
  entry: RenderTimelineEntry;
  isLast: boolean;
}) {
  if (entry.kind === "thinking") {
    return (
      <li className="activity-step grid grid-cols-[34px_minmax(0,1fr)] gap-3.5">
        <div className="flex flex-col items-center min-h-full" aria-hidden="true">
          <span className="inline-grid h-7 w-7 place-items-center border border-[rgba(255,255,255,0.1)] rounded-full bg-[rgba(255,255,255,0.02)] text-[rgba(245,240,232,0.62)]">
            <IconThinking />
          </span>
          {!isLast ? <span className="w-px flex-1 mt-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" /> : null}
        </div>
        <div className="min-w-0 pt-px">
          <div className="text-[rgba(245,240,232,0.78)] text-base leading-[1.65] [overflow-wrap:anywhere] break-words whitespace-pre-wrap">{entry.text}</div>
        </div>
      </li>
    );
  }

  if (entry.kind === "intermediate") {
    return (
      <li className="activity-step grid grid-cols-[34px_minmax(0,1fr)] gap-3.5">
        <div className="flex flex-col items-center min-h-full" aria-hidden="true">
          <span className="inline-grid h-7 w-7 place-items-center border border-[rgba(255,255,255,0.1)] rounded-full bg-[rgba(255,255,255,0.02)] text-[rgba(245,240,232,0.62)]">
            <IconInfo />
          </span>
          {!isLast ? <span className="w-px flex-1 mt-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" /> : null}
        </div>
        <div className="min-w-0 pt-px">
          <div className="text-[rgba(245,240,232,0.68)] text-[0.92rem] leading-[1.55] [overflow-wrap:anywhere] break-words whitespace-pre-wrap">{entry.text}</div>
        </div>
      </li>
    );
  }

  if (entry.kind === "tool") {
    // Extract task brief for coding_agent tool to show as subtitle
    let taskBrief: string | null = null;
    if (entry.title === "coding_agent_sandbox" && entry.input.trim()) {
      try {
        const parsed = JSON.parse(entry.input) as { taskBrief?: string };
        if (typeof parsed.taskBrief === "string" && parsed.taskBrief.trim()) {
          const brief = parsed.taskBrief.trim();
          taskBrief = brief.length > 180 ? brief.slice(0, 180) + "..." : brief;
        }
      } catch {
        // input may not be valid JSON
      }
    }

    return (
      <li className="activity-step grid grid-cols-[34px_minmax(0,1fr)] gap-3.5">
        <div className="flex flex-col items-center min-h-full" aria-hidden="true">
          <span className="inline-grid h-7 w-7 place-items-center border border-[rgba(255,255,255,0.1)] rounded-full bg-[rgba(255,255,255,0.02)] text-[rgba(245,240,232,0.62)]">
            <IconTool />
          </span>
          {!isLast ? <span className="w-px flex-1 mt-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" /> : null}
        </div>
        <div className="min-w-0 pt-px">
          <div className="flex min-w-0 items-center gap-2.5 flex-wrap">
            <div className="min-w-0 text-[rgba(245,240,232,0.9)] text-[0.96rem] font-medium tracking-[-0.01em]">{formatToolDisplayName(entry.title)}</div>
            <span className={`inline-flex items-center justify-center rounded-full px-[9px] py-1 text-[0.72rem] leading-none whitespace-nowrap ${
              entry.status === "running"
                ? "text-[rgba(232,210,162,0.9)] bg-[rgba(232,210,162,0.08)]"
                : entry.status === "completed"
                  ? "text-[rgba(190,222,209,0.84)] bg-[rgba(122,168,148,0.1)]"
                  : "text-[rgba(243,199,180,0.92)] bg-[rgba(181,103,69,0.12)]"
            }`}>{formatToolStatusLabel(entry.status)}</span>
          </div>
          {taskBrief ? (
            <div className="mt-1 text-[rgba(245,240,232,0.54)] text-[0.82rem] leading-[1.45] [overflow-wrap:anywhere] break-words">{taskBrief}</div>
          ) : null}
          {entry.runtime ? <div className="mt-1 text-[rgba(245,240,232,0.42)] text-[0.78rem]">{formatToolRuntimeLabel(entry.runtime)}</div> : null}
          <ToolStepDetails entry={entry} />
        </div>
      </li>
    );
  }

  if (entry.kind === "approval") {
    return (
      <li className="activity-step grid grid-cols-[34px_minmax(0,1fr)] gap-3.5">
        <div className="flex flex-col items-center min-h-full" aria-hidden="true">
          <span className="inline-grid h-7 w-7 place-items-center border border-[rgba(255,255,255,0.1)] rounded-full bg-[rgba(255,255,255,0.02)] text-[rgba(245,240,232,0.62)]">
            <IconInfo />
          </span>
          {!isLast ? <span className="w-px flex-1 mt-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" /> : null}
        </div>
        <div className="min-w-0 pt-px">
          <ApprovalCard entry={entry} />
        </div>
      </li>
    );
  }

  return (
    <li className="activity-step grid grid-cols-[34px_minmax(0,1fr)] gap-3.5">
      <div className="flex flex-col items-center min-h-full" aria-hidden="true">
        <span className="inline-grid h-7 w-7 place-items-center border border-[rgba(255,255,255,0.1)] rounded-full bg-[rgba(255,255,255,0.02)] text-[rgba(245,240,232,0.62)]">
          {entry.kind === "system" ? <IconDone /> : <IconInfo />}
        </span>
        {!isLast ? <span className="w-px flex-1 mt-2 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" /> : null}
      </div>
      <div className="min-w-0 pt-px">
        <div className="min-w-0 text-[rgba(245,240,232,0.9)] text-[0.96rem] font-medium tracking-[-0.01em]">{entry.title}</div>
        <div className="text-[rgba(245,240,232,0.78)] text-base leading-[1.65] [overflow-wrap:anywhere] break-words whitespace-pre-wrap">{entry.description}</div>
      </div>
    </li>
  );
}
