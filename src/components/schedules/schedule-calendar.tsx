"use client";

import { useState } from "react";

import { IconClock, IconSidebarToggle } from "@/components/icons";
import { ScheduleCard } from "@/components/schedules/schedule-card";
import { ScheduleDetailModal } from "@/components/schedules/schedule-detail-modal";
import { useScheduledPrompts } from "@/lib/api-hooks";

const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, PAUSED: 1, COMPLETED: 2, CANCELLED: 3 };

export function ScheduleCalendar({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const { data: schedules = [], isLoading } = useScheduledPrompts();

  const sorted = [...schedules].sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    if (a.nextRunAt && b.nextRunAt) return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
    if (a.nextRunAt) return -1;
    if (b.nextRunAt) return 1;
    return 0;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.06)] max-[980px]:px-[18px]">
        <div className="flex items-center gap-2.5">
          {onOpenSidebar && (
            <button
              type="button"
              className="hidden max-[980px]:inline-grid h-10 w-10 place-items-center border-0 bg-transparent text-[rgba(236,230,219,0.56)] cursor-pointer rounded-[10px] transition-[background,color] duration-140 ease-linear hover:bg-[#2f2f2d] hover:text-[rgba(247,242,233,0.92)] shrink-0"
              aria-label="Open navigation"
              onClick={onOpenSidebar}
            >
              <IconSidebarToggle />
            </button>
          )}
          <h1 className="text-[1.15rem] font-semibold text-[rgba(245,240,232,0.92)]">Schedules</h1>
          {sorted.length > 0 && (
            <span className="text-[0.78rem] text-[rgba(245,240,232,0.4)]">
              {sorted.filter((s) => s.status === "ACTIVE").length} active
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-[rgba(245,240,232,0.5)] text-[0.88rem]">
            Loading schedules...
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="h-10 w-10 rounded-full bg-[rgba(255,255,255,0.04)] inline-grid place-items-center text-[rgba(245,240,232,0.3)]">
              <IconClock />
            </div>
            <p className="text-[rgba(245,240,232,0.5)] text-[0.92rem]">No scheduled prompts yet</p>
            <p className="text-[rgba(245,240,232,0.3)] text-[0.82rem] max-w-[300px] text-center">
              Type a prompt and click the clock icon in the composer to schedule it
            </p>
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-2">
            {sorted.map((s) => (
              <ScheduleCard key={s.id} schedule={s} onClick={() => setSelectedScheduleId(s.id)} />
            ))}
          </div>
        )}
      </div>

      {selectedScheduleId && (
        <ScheduleDetailModal scheduleId={selectedScheduleId} onClose={() => setSelectedScheduleId(null)} />
      )}
    </div>
  );
}
