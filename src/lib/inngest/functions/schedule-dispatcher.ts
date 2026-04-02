import { inngest } from "@/lib/inngest/client";
import { computeNextRunAt } from "@/lib/inngest/cron-utils";
import { prisma } from "@/lib/prisma";

/**
 * Runs every minute. Finds all ACTIVE scheduled prompts whose nextRunAt has passed,
 * dispatches an execute event for each, and advances nextRunAt.
 */
export const scheduleDispatcher = inngest.createFunction(
  { id: "schedule-dispatcher", name: "Schedule Dispatcher" },
  { cron: "* * * * *" },
  async ({ step }) => {
    const now = new Date();
    console.log("[dispatcher] tick at", now.toISOString());

    const dueSchedules = await step.run("find-due-schedules", async () => {
      const schedules = await prisma.scheduledPrompt.findMany({
        where: {
          status: "ACTIVE",
          nextRunAt: { lte: new Date() },
        },
        select: {
          id: true,
          cronExpression: true,
          timezone: true,
          maxRuns: true,
          totalRuns: true,
          nextRunAt: true,
          prompt: true,
        },
      });
      console.log("[dispatcher] found", schedules.length, "due schedules");
      for (const s of schedules) {
        console.log("[dispatcher]   ->", s.id, {
          cron: s.cronExpression,
          nextRunAt: s.nextRunAt?.toISOString(),
          totalRuns: s.totalRuns,
          prompt: s.prompt.slice(0, 60),
        });
      }
      return schedules;
    });

    if (dueSchedules.length === 0) return { dispatched: 0 };

    // Dispatch execute events via step.sendEvent (no event key needed)
    const events = dueSchedules.map((schedule) => {
      const nextRunStr = schedule.nextRunAt ? String(schedule.nextRunAt) : new Date().toISOString();
      return {
        name: "scheduled-prompt/execute" as const,
        data: {
          scheduledPromptId: schedule.id,
          nextRunAt: nextRunStr,
        },
        id: `schedule-${schedule.id}-${nextRunStr}`,
      };
    });

    console.log("[dispatcher] sending", events.length, "execute events");
    await step.sendEvent("dispatch-events", events);

    // Advance nextRunAt for each schedule (totalRuns incremented by executor after completion)
    await step.run("advance-next-run", async () => {
      await Promise.all(
        dueSchedules.map(async (schedule) => {
          const nextRunAt = computeNextRunAt(schedule.cronExpression, schedule.timezone);
          console.log("[dispatcher] schedule", schedule.id, "advanced nextRunAt to", nextRunAt.toISOString());
          await prisma.scheduledPrompt.update({
            where: { id: schedule.id },
            data: { nextRunAt },
          });
        }),
      );
    });

    console.log("[dispatcher] dispatched", dueSchedules.length, "schedules");
    return { dispatched: dueSchedules.length };
  },
);
