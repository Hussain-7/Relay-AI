"use client";

import type { ScheduledPromptDto } from "@/lib/api-hooks";

const STATUS_STYLES: Record<string, { dot: string; text: string; label: string }> = {
  ACTIVE: { dot: "bg-emerald-400", text: "text-emerald-400", label: "Active" },
  PAUSED: { dot: "bg-yellow-400", text: "text-yellow-400", label: "Paused" },
  COMPLETED: { dot: "bg-[rgba(245,240,232,0.3)]", text: "text-[rgba(245,240,232,0.4)]", label: "Done" },
  CANCELLED: { dot: "bg-[rgba(245,240,232,0.15)]", text: "text-[rgba(245,240,232,0.3)]", label: "Cancelled" },
};

function formatNextRun(nextRunAt: string | null): string {
  if (!nextRunAt) return "—";
  const d = new Date(nextRunAt);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `in ${diffMins}m`;
  if (diffMins < 1440) {
    const h = Math.floor(diffMins / 60);
    return `in ${h}h`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
      className="w-full text-left border border-[rgba(255,255,255,0.06)] rounded-[12px] bg-[rgba(255,255,255,0.02)] px-4 py-3.5 cursor-pointer transition-[background,border-color] duration-150 hover:bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.12)]"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          <p className="text-[0.88rem] text-[rgba(245,240,232,0.88)] truncate leading-snug">
            {schedule.label || schedule.prompt}
          </p>
          <div className="flex items-center gap-2 mt-1 text-[0.78rem] text-[rgba(245,240,232,0.4)] flex-wrap">
            <span>{schedule.cronDescription}</span>
            <span className="text-[rgba(255,255,255,0.15)]">&middot;</span>
            <span>
              {schedule.totalRuns} run{schedule.totalRuns !== 1 ? "s" : ""}
              {schedule.maxRuns ? ` / ${schedule.maxRuns}` : ""}
            </span>
            {schedule.nextRunAt && (
              <>
                <span className="text-[rgba(255,255,255,0.15)]">&middot;</span>
                <span>Next: {formatNextRun(schedule.nextRunAt)}</span>
              </>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          <span className={`text-[0.75rem] ${status.text}`}>{status.label}</span>
        </div>
      </div>
    </button>
  );
}
