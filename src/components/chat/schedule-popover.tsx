"use client";

import { Plus } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FREQUENCIES = ["hourly", "daily", "weekdays", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

interface SchedulePopoverProps {
  anchor: HTMLElement | null;
  onSchedule: (config: {
    cronExpression: string;
    cronDescription: string;
    timezone: string;
    maxRuns?: number;
    label?: string;
  }) => void;
  onClose: () => void;
}

export function SchedulePopoverPortal({ anchor, onSchedule, onClose }: SchedulePopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxRuns, setMaxRuns] = useState<number | undefined>(undefined);
  const [hasRunLimit, setHasRunLimit] = useState(false);
  const [label, setLabel] = useState("");
  const [customCron, setCustomCron] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useLayoutEffect(() => {
    if (!anchor || !panelRef.current) return;
    const updatePosition = () => {
      if (!anchor || !panelRef.current) return;
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const left = Math.max(12, rect.left + rect.width / 2 - panel.offsetWidth / 2);
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(12, rect.top - panel.offsetHeight - 12)}px`;
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [anchor, showAdvanced, showCustom, frequency]);

  const timeLabel = useMemo(() => {
    const h = hour === 0 ? "12" : hour > 12 ? `${hour - 12}` : `${hour}`;
    const period = hour >= 12 ? "PM" : "AM";
    return `${h}:${minute.toString().padStart(2, "0")} ${period}`;
  }, [hour, minute]);

  const { cron, description } = useMemo(() => {
    if (showCustom && customCron.trim().split(/\s+/).length === 5) {
      return { cron: customCron.trim(), description: customCron.trim() };
    }
    const m = minute.toString();
    const h = hour.toString();
    switch (frequency) {
      case "hourly":
        return { cron: `${m} * * * *`, description: `Every hour at :${m.padStart(2, "0")}` };
      case "daily":
        return { cron: `${m} ${h} * * *`, description: `Daily at ${timeLabel}` };
      case "weekdays":
        return { cron: `${m} ${h} * * 1-5`, description: `Weekdays at ${timeLabel}` };
      case "weekly":
        return { cron: `${m} ${h} * * ${dayOfWeek}`, description: `Every ${DAYS_OF_WEEK[dayOfWeek]} at ${timeLabel}` };
      case "monthly": {
        const ord = dayOfMonth === 1 ? "1st" : dayOfMonth === 2 ? "2nd" : dayOfMonth === 3 ? "3rd" : `${dayOfMonth}th`;
        return { cron: `${m} ${h} ${dayOfMonth} * *`, description: `Monthly on the ${ord} at ${timeLabel}` };
      }
    }
  }, [frequency, hour, minute, dayOfWeek, dayOfMonth, timeLabel, showCustom, customCron]);

  function handleConfirm() {
    onSchedule({
      cronExpression: cron,
      cronDescription: description,
      timezone,
      maxRuns: hasRunLimit ? maxRuns : undefined,
      label: label.trim() || undefined,
    });
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[999]" onClick={onClose} />

      <div
        ref={panelRef}
        className="fixed z-[1000] w-[320px] border border-[rgba(255,255,255,0.12)] rounded-[16px] bg-[rgb(40,38,35)] shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h3 className="text-[0.92rem] font-semibold text-[rgba(245,240,232,0.92)]">Schedule prompt</h3>
          <button
            type="button"
            className="inline-grid h-6 w-6 place-items-center border-0 bg-transparent text-[rgba(245,240,232,0.5)] cursor-pointer rounded-full hover:text-[rgba(245,240,232,0.85)]"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        {showCustom ? (
          /* ── Custom cron input ── */
          <div className="px-4 pb-4 flex flex-col gap-3">
            <div>
              <label className="block text-[0.75rem] text-[rgba(245,240,232,0.5)] mb-1">Cron expression</label>
              <input
                type="text"
                className="w-full rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[0.84rem] font-mono text-foreground outline-none focus:border-accent transition-colors"
                placeholder="0 9 * * 1-5"
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
              />
              <p className="mt-1 text-[0.68rem] text-[rgba(245,240,232,0.35)]">
                min hour day-of-month month day-of-week
              </p>
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-[0.82rem] text-[rgba(245,240,232,0.55)] cursor-pointer border-0 bg-transparent hover:text-[rgba(245,240,232,0.85)]"
                onClick={() => setShowCustom(false)}
              >
                Back
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-accent px-4 py-2 text-[0.84rem] font-medium text-white border-0 cursor-pointer hover:bg-[#dd7851] disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={customCron.trim().split(/\s+/).length !== 5}
                onClick={handleConfirm}
              >
                Schedule
              </button>
            </div>
          </div>
        ) : (
          /* ── Frequency tabs + time config ── */
          <div className="px-4 pb-4 flex flex-col gap-3">
            {/* Frequency toggle */}
            <div className="flex rounded-[10px] bg-[rgba(255,255,255,0.04)] p-[3px] gap-[2px]">
              {FREQUENCIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`flex-1 rounded-[8px] py-[6px] text-[0.74rem] border-0 cursor-pointer transition-all duration-150 capitalize ${
                    frequency === f
                      ? "bg-[rgba(255,255,255,0.1)] text-[rgba(245,240,232,0.92)] shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
                      : "bg-transparent text-[rgba(245,240,232,0.45)] hover:text-[rgba(245,240,232,0.7)]"
                  }`}
                  onClick={() => setFrequency(f)}
                >
                  {f === "weekdays" ? "Wkdays" : f}
                </button>
              ))}
            </div>

            {/* Time picker — not for hourly */}
            {frequency !== "hourly" ? (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-[0.72rem] text-[rgba(245,240,232,0.45)] mb-1">Time</label>
                  <div className="flex gap-1.5">
                    <select
                      className="flex-1 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2 py-1.5 text-[0.84rem] text-foreground outline-none"
                      value={hour}
                      onChange={(e) => setHour(Number(e.target.value))}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i === 0 ? "12 AM" : i < 12 ? `${i} AM` : i === 12 ? "12 PM" : `${i - 12} PM`}
                        </option>
                      ))}
                    </select>
                    <select
                      className="w-[72px] rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2 py-1.5 text-[0.84rem] text-foreground outline-none"
                      value={minute}
                      onChange={(e) => setMinute(Number(e.target.value))}
                    >
                      {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                        <option key={m} value={m}>
                          :{m.toString().padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[0.72rem] text-[rgba(245,240,232,0.45)] mb-1">At minute</label>
                <select
                  className="w-full rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2 py-1.5 text-[0.84rem] text-foreground outline-none"
                  value={minute}
                  onChange={(e) => setMinute(Number(e.target.value))}
                >
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                    <option key={m} value={m}>
                      :{m.toString().padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Day of week — weekly only */}
            {frequency === "weekly" && (
              <div>
                <label className="block text-[0.72rem] text-[rgba(245,240,232,0.45)] mb-1">Day</label>
                <div className="flex gap-[3px]">
                  {DAYS_OF_WEEK.map((day, i) => (
                    <button
                      key={day}
                      type="button"
                      className={`flex-1 rounded-[7px] border py-[6px] text-[0.72rem] cursor-pointer transition-colors ${
                        dayOfWeek === i
                          ? "border-accent bg-[rgba(221,113,72,0.15)] text-accent"
                          : "border-[rgba(255,255,255,0.08)] bg-transparent text-[rgba(245,240,232,0.5)] hover:bg-[rgba(255,255,255,0.04)]"
                      }`}
                      onClick={() => setDayOfWeek(i)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Day of month — monthly only */}
            {frequency === "monthly" && (
              <div>
                <label className="block text-[0.72rem] text-[rgba(245,240,232,0.45)] mb-1">Day of month</label>
                <select
                  className="w-full rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2 py-1.5 text-[0.84rem] text-foreground outline-none"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 28 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Preview */}
            <div className="rounded-[8px] bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] px-3 py-2 flex items-center justify-between">
              <span className="text-[0.82rem] text-[rgba(245,240,232,0.8)]">{description}</span>
              <span className="text-[0.72rem] font-mono text-[rgba(245,240,232,0.35)]">{cron}</span>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              className="text-left text-[0.78rem] text-[rgba(245,240,232,0.4)] cursor-pointer border-0 bg-transparent hover:text-[rgba(245,240,232,0.65)] transition-colors"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide options" : "More options"}
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-2.5">
                {/* Label */}
                <input
                  type="text"
                  className="w-full rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[0.84rem] text-foreground outline-none focus:border-accent transition-colors"
                  placeholder="Label (optional)"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />

                {/* Run limit */}
                <div className="flex items-center justify-between">
                  <span className="text-[0.82rem] text-[rgba(245,240,232,0.6)]">Limit runs</span>
                  <button
                    type="button"
                    onClick={() => {
                      setHasRunLimit(!hasRunLimit);
                      if (!hasRunLimit) setMaxRuns(10);
                    }}
                    className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border-0 transition-colors duration-200 ${
                      hasRunLimit ? "bg-accent" : "bg-[rgba(255,255,255,0.12)]"
                    }`}
                  >
                    <span
                      className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        hasRunLimit ? "translate-x-[18px]" : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                </div>
                {hasRunLimit && (
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    className="w-full rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1.5 text-[0.84rem] text-foreground outline-none focus:border-accent"
                    placeholder="Max runs"
                    value={maxRuns ?? ""}
                    onChange={(e) => setMaxRuns(e.target.value ? Number(e.target.value) : undefined)}
                  />
                )}

                {/* Custom cron link */}
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-[0.78rem] text-accent cursor-pointer border-0 bg-transparent hover:underline"
                  onClick={() => {
                    setCustomCron(cron);
                    setShowCustom(true);
                  }}
                >
                  <Plus size={13} />
                  Custom cron expression
                </button>

                {/* Timezone */}
                <p className="text-[0.7rem] text-[rgba(245,240,232,0.3)]">{timezone}</p>
              </div>
            )}

            {/* Schedule button */}
            <button
              type="button"
              className="w-full rounded-[10px] bg-accent py-2.5 text-[0.86rem] font-medium text-white border-0 cursor-pointer transition-colors duration-150 hover:bg-[#dd7851]"
              onClick={handleConfirm}
            >
              Schedule
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
