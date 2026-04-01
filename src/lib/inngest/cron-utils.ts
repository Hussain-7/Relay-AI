import { CronExpressionParser } from "cron-parser";

/**
 * Compute the next run time for a cron expression in a given timezone.
 */
export function computeNextRunAt(cronExpression: string, timezone: string, after?: Date): Date {
  const interval = CronExpressionParser.parse(cronExpression, {
    tz: timezone,
    currentDate: after ?? new Date(),
  });
  return interval.next().toDate();
}

/**
 * Validate a cron expression. Returns true if valid.
 */
export function validateCronExpression(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a list of future occurrence dates for a cron expression (for calendar rendering).
 */
export function getOccurrences(cronExpression: string, timezone: string, from: Date, to: Date, maxCount = 200): Date[] {
  const interval = CronExpressionParser.parse(cronExpression, {
    tz: timezone,
    currentDate: from,
    endDate: to,
  });

  const dates: Date[] = [];
  while (dates.length < maxCount) {
    try {
      dates.push(interval.next().toDate());
    } catch {
      break; // No more occurrences in range
    }
  }
  return dates;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"] as const;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/**
 * Convert a cron expression to a human-readable description.
 * Handles common patterns; falls back to raw expression for complex ones.
 */
export function describeCron(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const timeStr = formatTime(minute, hour);

  // Every minute
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "Every minute";
  }

  // Every hour at :MM
  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Every hour at :${minute!.padStart(2, "0")}`;
  }

  // Specific hour patterns
  if (minute !== "*" && hour !== "*" && !hour!.includes(",") && !hour!.includes("/")) {
    // Daily
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Every day at ${timeStr}`;
    }

    // Weekdays
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
      return `Every weekday at ${timeStr}`;
    }

    // Specific days of week
    if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
      const days = parseDaysOfWeek(dayOfWeek!);
      if (days) return `Every ${days} at ${timeStr}`;
    }

    // Specific day of month
    if (dayOfMonth !== "*" && !dayOfMonth!.includes(",") && month === "*" && dayOfWeek === "*") {
      const dom = Number.parseInt(dayOfMonth!, 10);
      if (!Number.isNaN(dom) && dom >= 1 && dom <= 31) {
        const ordinal = dom <= 5 ? ORDINALS[dom - 1] : `${dom}th`;
        return `Monthly on the ${ordinal} at ${timeStr}`;
      }
    }
  }

  // Interval patterns: */N
  if (hour!.startsWith("*/")) {
    const interval = hour!.slice(2);
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `Every ${interval} hours at :${minute!.padStart(2, "0")}`;
    }
  }

  return cronExpression;
}

function formatTime(minute: string | undefined, hour: string | undefined): string {
  if (!minute || !hour) return "";
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return `${hour}:${minute}`;
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
}

function parseDaysOfWeek(dow: string): string | null {
  const nums = dow.split(",").map((s) => Number.parseInt(s.trim(), 10));
  if (nums.some(Number.isNaN)) return null;
  return nums.map((n) => DAY_NAMES[n] ?? `day ${n}`).join(", ");
}
