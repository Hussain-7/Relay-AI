"use client";

import type { ScheduledPromptDto } from "@/lib/api-hooks";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  ACTIVE: { bg: "bg-[rgba(122,168,148,0.15)]", text: "text-accent-2", label: "Active" },
  PAUSED: { bg: "bg-[rgba(255,193,7,0.12)]", text: "text-[#ffc107]", label: "Paused" },
  COMPLETED: { bg: "bg-[rgba(255,255,255,0.06)]", text: "text-[rgba(245,240,232,0.5)]", label: "Completed" },
  CANCELLED: { bg: "bg-[rgba(255,255,255,0.04)]", text: "text-[rgba(245,240,232,0.35)]", label: "Cancelled" },
};

export function ScheduleCard({
  schedule,
  compact = false,
  onClick,
}: {
  schedule: ScheduledPromptDto;
  compact?: boolean;
  onClick?: () => void;
}) {
  const status = STATUS_STYLES[schedule.status] ?? STATUS_STYLES.ACTIVE;

  if (compact) {
    return (
      <button
        type="button"
        className="w-full text-left border-0 rounded-[6px] bg-[rgba(221,113,72,0.12)] px-1.5 py-0.5 text-[0.68rem] text-accent cursor-pointer truncate hover:bg-[rgba(221,113,72,0.2)] transition-colors"
        onClick={onClick}
        title={schedule.label || schedule.prompt}
      >
        {schedule.label || schedule.prompt.slice(0, 30)}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="w-full text-left border border-[rgba(255,255,255,0.08)] rounded-[12px] bg-[rgba(255,255,255,0.02)] p-3.5 cursor-pointer transition-[background,border-color] duration-150 hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.14)]"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-[0.88rem] font-medium text-[rgba(245,240,232,0.9)] line-clamp-1">
          {schedule.label || schedule.prompt.slice(0, 60)}
        </h4>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>

      {schedule.label && (
        <p className="text-[0.78rem] text-[rgba(245,240,232,0.5)] line-clamp-2 mb-1.5">
          {schedule.prompt.slice(0, 100)}
        </p>
      )}

      <div className="flex items-center gap-3 text-[0.75rem] text-[rgba(245,240,232,0.45)]">
        <span>{schedule.cronDescription}</span>
        <span>&middot;</span>
        <span>
          {schedule.totalRuns} run{schedule.totalRuns !== 1 ? "s" : ""}
          {schedule.maxRuns ? ` / ${schedule.maxRuns}` : ""}
        </span>
        {schedule.nextRunAt && (
          <>
            <span>&middot;</span>
            <span>
              Next: {new Date(schedule.nextRunAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </span>
          </>
        )}
      </div>
    </button>
  );
}
