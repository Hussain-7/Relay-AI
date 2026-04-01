"use client";

import { useMemo, useState } from "react";

import { IconChevron } from "@/components/icons";
import { ScheduleCard } from "@/components/schedules/schedule-card";
import { ScheduleDetailModal } from "@/components/schedules/schedule-detail-modal";
import { type ScheduledPromptDto, useScheduledPrompts } from "@/lib/api-hooks";

type ViewMode = "month" | "week" | "day" | "list";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return startOfDay(d);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function ScheduleCalendar() {
  const [view, setView] = useState<ViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);

  const { data: schedules = [], isLoading } = useScheduledPrompts();

  // Group schedules by their nextRunAt date for calendar rendering
  const schedulesByDate = useMemo(() => {
    const map = new Map<string, ScheduledPromptDto[]>();
    for (const s of schedules) {
      if (!s.nextRunAt) continue;
      const key = startOfDay(new Date(s.nextRunAt)).toISOString();
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [schedules]);

  function getSchedulesForDay(date: Date): ScheduledPromptDto[] {
    return schedulesByDate.get(startOfDay(date).toISOString()) ?? [];
  }

  // Navigation
  function navigate(direction: -1 | 1) {
    if (view === "month") setCurrentDate(addMonths(currentDate, direction));
    else if (view === "week") setCurrentDate(addDays(currentDate, direction * 7));
    else if (view === "day") setCurrentDate(addDays(currentDate, direction));
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // Month view calendar grid
  const monthGrid = useMemo(() => {
    const first = startOfMonth(currentDate);
    const last = endOfMonth(currentDate);
    const gridStart = startOfWeek(first);
    const weeks: Date[][] = [];
    let current = gridStart;
    while (current <= last || weeks.length < 5) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(current));
        current = addDays(current, 1);
      }
      weeks.push(week);
      if (weeks.length >= 6) break;
    }
    return weeks;
  }, [currentDate]);

  // Week view days
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const headerTitle = useMemo(() => {
    if (view === "month") return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (view === "week") {
      const start = startOfWeek(currentDate);
      const end = addDays(start, 6);
      const sMonth = MONTH_NAMES[start.getMonth()]!.slice(0, 3);
      const eMonth = MONTH_NAMES[end.getMonth()]!.slice(0, 3);
      return start.getMonth() === end.getMonth()
        ? `${sMonth} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`
        : `${sMonth} ${start.getDate()} - ${eMonth} ${end.getDate()}, ${end.getFullYear()}`;
    }
    if (view === "day") {
      return currentDate.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    return "All Schedules";
  }, [view, currentDate]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-3">
          <h1 className="text-[1.2rem] font-semibold text-[rgba(245,240,232,0.92)]">{headerTitle}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="h-7 w-7 inline-grid place-items-center rounded-full border-0 bg-transparent text-[rgba(245,240,232,0.5)] cursor-pointer hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.85)] transition-colors"
              onClick={() => navigate(-1)}
            >
              <span className="rotate-90">
                <IconChevron />
              </span>
            </button>
            <button
              type="button"
              className="rounded-[6px] border border-[rgba(255,255,255,0.1)] bg-transparent px-2.5 py-0.5 text-[0.78rem] text-[rgba(245,240,232,0.65)] cursor-pointer hover:bg-[rgba(255,255,255,0.04)] transition-colors"
              onClick={goToday}
            >
              Today
            </button>
            <button
              type="button"
              className="h-7 w-7 inline-grid place-items-center rounded-full border-0 bg-transparent text-[rgba(245,240,232,0.5)] cursor-pointer hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(245,240,232,0.85)] transition-colors"
              onClick={() => navigate(1)}
            >
              <span className="-rotate-90">
                <IconChevron />
              </span>
            </button>
          </div>
        </div>

        {/* View mode toggles */}
        <div className="flex items-center gap-0.5 rounded-[8px] bg-[rgba(255,255,255,0.04)] p-0.5">
          {(["month", "week", "day", "list"] as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              className={`rounded-[6px] px-3 py-1 text-[0.78rem] border-0 cursor-pointer transition-colors duration-150 capitalize ${
                view === v
                  ? "bg-[rgba(255,255,255,0.1)] text-[rgba(245,240,232,0.9)]"
                  : "bg-transparent text-[rgba(245,240,232,0.5)] hover:text-[rgba(245,240,232,0.75)]"
              }`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-[rgba(245,240,232,0.5)] text-[0.88rem]">
            Loading schedules...
          </div>
        ) : view === "month" ? (
          /* ── Month View ── */
          <div className="h-full flex flex-col">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-[rgba(255,255,255,0.06)]">
              {DAY_NAMES.map((day) => (
                <div
                  key={day}
                  className="px-2 py-2 text-center text-[0.72rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)]"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 flex-1 auto-rows-fr">
              {monthGrid.flat().map((date) => {
                const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                const isToday = isSameDay(date, today);
                const daySchedules = getSchedulesForDay(date);

                return (
                  <div
                    key={date.toISOString()}
                    className={`border-b border-r border-[rgba(255,255,255,0.04)] p-1.5 min-h-[80px] cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.02)] ${
                      !isCurrentMonth ? "opacity-40" : ""
                    }`}
                    onClick={() => {
                      setCurrentDate(date);
                      if (daySchedules.length > 0) setView("day");
                    }}
                  >
                    <div
                      className={`text-[0.78rem] mb-1 ${
                        isToday
                          ? "inline-grid h-6 w-6 place-items-center rounded-full bg-accent text-white font-semibold"
                          : "text-[rgba(245,240,232,0.65)] pl-0.5"
                      }`}
                    >
                      {date.getDate()}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {daySchedules.slice(0, 3).map((s) => (
                        <ScheduleCard
                          key={s.id}
                          schedule={s}
                          compact
                          onClick={() => {
                            setSelectedScheduleId(s.id);
                          }}
                        />
                      ))}
                      {daySchedules.length > 3 && (
                        <span className="text-[0.65rem] text-[rgba(245,240,232,0.4)] pl-1.5">
                          +{daySchedules.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : view === "week" ? (
          /* ── Week View ── */
          <div className="h-full flex flex-col">
            <div className="grid grid-cols-7 border-b border-[rgba(255,255,255,0.06)]">
              {weekDays.map((date) => {
                const isToday = isSameDay(date, today);
                const daySchedules = getSchedulesForDay(date);
                return (
                  <div key={date.toISOString()} className="border-r border-[rgba(255,255,255,0.04)] p-2 min-h-[100px]">
                    <div
                      className={`text-center mb-2 ${isToday ? "text-accent font-semibold" : "text-[rgba(245,240,232,0.6)]"}`}
                    >
                      <div className="text-[0.68rem] uppercase">{DAY_NAMES[date.getDay()]}</div>
                      <div
                        className={`text-[1.1rem] ${isToday ? "inline-grid h-8 w-8 place-items-center rounded-full bg-accent text-white" : ""}`}
                      >
                        {date.getDate()}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {daySchedules.map((s) => (
                        <ScheduleCard key={s.id} schedule={s} compact onClick={() => setSelectedScheduleId(s.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : view === "day" ? (
          /* ── Day View ── */
          <div className="p-6">
            <div className="flex flex-col gap-2">
              {getSchedulesForDay(currentDate).length > 0 ? (
                getSchedulesForDay(currentDate).map((s) => (
                  <ScheduleCard key={s.id} schedule={s} onClick={() => setSelectedScheduleId(s.id)} />
                ))
              ) : (
                <div className="text-center py-12 text-[rgba(245,240,232,0.4)] text-[0.88rem]">
                  No schedules for this day
                </div>
              )}
            </div>

            {/* Also show all active schedules */}
            <div className="mt-8">
              <h3 className="text-[0.82rem] uppercase tracking-wider text-[rgba(245,240,232,0.4)] mb-3">All Active</h3>
              <div className="flex flex-col gap-2">
                {schedules
                  .filter((s) => s.status === "ACTIVE" || s.status === "PAUSED")
                  .map((s) => (
                    <ScheduleCard key={s.id} schedule={s} onClick={() => setSelectedScheduleId(s.id)} />
                  ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── List View ── */
          <div className="p-6">
            {schedules.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[rgba(245,240,232,0.5)] text-[0.92rem] mb-2">No scheduled prompts yet</p>
                <p className="text-[rgba(245,240,232,0.35)] text-[0.82rem]">
                  Type a prompt and click the clock icon to schedule it
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {schedules.map((s) => (
                  <ScheduleCard key={s.id} schedule={s} onClick={() => setSelectedScheduleId(s.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedScheduleId && (
        <ScheduleDetailModal scheduleId={selectedScheduleId} onClose={() => setSelectedScheduleId(null)} />
      )}
    </div>
  );
}
