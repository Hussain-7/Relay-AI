import { RunStatus } from "@/generated/prisma/client";
import { createConversationForUser } from "@/lib/conversations";
import { sendEmail } from "@/lib/email";
import { scheduleReportEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { inngest } from "@/lib/inngest/client";
import { executeMainAgentHeadless } from "@/lib/main-agent/headless";
import { prisma } from "@/lib/prisma";
import { invalidateCache } from "@/lib/server-cache";

/**
 * Triggered by "scheduled-prompt/execute" events from the dispatcher.
 * Ensures a conversation exists, runs the agent headlessly, and records the execution.
 */
export const scheduleExecutor = inngest.createFunction(
  {
    id: "schedule-executor",
    name: "Schedule Executor",
    retries: 2,
    timeouts: { finish: "5m" },
    concurrency: [{ limit: 5 }],
  },
  { event: "scheduled-prompt/execute" },
  async ({ event, step }) => {
    const { scheduledPromptId } = event.data;
    console.log("[executor] received event for schedule", scheduledPromptId);

    // Step 1: Load schedule and validate
    const schedule = await step.run("load-schedule", async () => {
      const s = await prisma.scheduledPrompt.findUnique({
        where: { id: scheduledPromptId },
        include: { conversation: { select: { id: true } } },
      });
      if (!s) {
        console.error("[executor] schedule not found:", scheduledPromptId);
        throw new Error(`Schedule ${scheduledPromptId} not found`);
      }
      console.log("[executor] loaded schedule", s.id, {
        status: s.status,
        conversationId: s.conversationId,
        totalRuns: s.totalRuns,
        prompt: s.prompt.slice(0, 60),
      });
      if (s.status !== "ACTIVE" && s.status !== "COMPLETED") {
        return null;
      }
      return {
        id: s.id,
        userId: s.userId,
        prompt: s.prompt,
        conversationId: s.conversationId,
        repoBindingId: s.repoBindingId,
        preferencesJson: s.preferencesJson as Record<string, unknown> | null,
        mcpConnectorIds: s.mcpConnectorIds as string[] | null,
        label: s.label,
        notifyEmail: s.notifyEmail,
      };
    });

    if (!schedule) {
      console.log("[executor] skipping — schedule not active");
      return { skipped: true, reason: "not active" };
    }

    // Step 2: Ensure conversation exists
    const conversationId = await step.run("ensure-conversation", async () => {
      if (schedule.conversationId) {
        console.log("[executor] reusing conversation", schedule.conversationId);
        return schedule.conversationId;
      }

      const title = schedule.label || `Scheduled: ${schedule.prompt.slice(0, 50)}...`;
      console.log("[executor] creating conversation:", title);
      const conversation = await createConversationForUser({
        userId: schedule.userId,
        title,
        repoBindingId: schedule.repoBindingId ?? undefined,
      });

      await prisma.scheduledPrompt.update({
        where: { id: schedule.id },
        data: { conversationId: conversation.id },
      });

      console.log("[executor] created conversation", conversation.id);
      return conversation.id;
    });

    // Step 3: Create execution record
    const executionId = await step.run("create-execution", async () => {
      const execution = await prisma.scheduledExecution.create({
        data: {
          scheduledPromptId: schedule.id,
          status: RunStatus.RUNNING,
          startedAt: new Date(),
        },
      });
      console.log("[executor] created execution record", execution.id);
      return execution.id;
    });

    // Run the agent and record result — NOT wrapped in step.run() because
    // the Anthropic API call can take 30-120s which exceeds Inngest's step HTTP timeout.
    // After the memoized steps above, this runs inline in the function invocation.
    const prefs = schedule.preferencesJson as {
      model?: string;
      thinking?: boolean;
      effort?: "low" | "medium" | "high";
      memory?: boolean;
    } | null;

    console.log("[executor] starting headless agent run", {
      conversationId,
      model: prefs?.model,
      prompt: schedule.prompt.slice(0, 60),
    });

    const startTime = Date.now();
    let result: Awaited<ReturnType<typeof executeMainAgentHeadless>>;
    try {
      result = await executeMainAgentHeadless({
        conversationId,
        userId: schedule.userId,
        prompt: schedule.prompt,
        preferences: prefs ?? undefined,
        mcpConnectorIds: schedule.mcpConnectorIds ?? undefined,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[executor] agent run threw:", errorMsg);
      await prisma.scheduledExecution.update({
        where: { id: executionId },
        data: { status: RunStatus.FAILED, completedAt: new Date(), errorMessage: errorMsg },
      });
      throw err;
    }

    console.log("[executor] agent run completed in", Date.now() - startTime, "ms", {
      runId: result.runId,
      success: result.success,
      error: result.error,
      textLength: result.finalText.length,
    });

    // Record execution result and increment totalRuns
    const [, updatedSchedule] = await Promise.all([
      prisma.scheduledExecution.update({
        where: { id: executionId },
        data: {
          runId: result.runId,
          status: result.success ? RunStatus.COMPLETED : RunStatus.FAILED,
          completedAt: new Date(),
          errorMessage: result.error ?? null,
        },
      }),
      prisma.scheduledPrompt.update({
        where: { id: schedule.id },
        data: { totalRuns: { increment: 1 }, lastRunAt: new Date() },
        select: { totalRuns: true, maxRuns: true },
      }),
    ]);

    // Check if maxRuns reached after this execution
    if (updatedSchedule.maxRuns != null && updatedSchedule.totalRuns >= updatedSchedule.maxRuns) {
      await prisma.scheduledPrompt.update({
        where: { id: schedule.id },
        data: { status: "COMPLETED", nextRunAt: null },
      });
      console.log("[executor] schedule reached maxRuns, marked COMPLETED");
    }

    void invalidateCache(`conv:${conversationId}`, `convos:${schedule.userId}`);
    console.log("[executor] execution recorded", {
      executionId,
      status: result.success ? "COMPLETED" : "FAILED",
    });

    // Send email notification if enabled
    if (schedule.notifyEmail && result.success) {
      try {
        const user = await prisma.userProfile.findUnique({
          where: { userId: schedule.userId },
          select: { email: true },
        });
        if (user?.email) {
          const email = scheduleReportEmail({
            prompt: schedule.prompt,
            responseText: result.finalText,
            conversationUrl: `${env.APP_URL}/chat/${conversationId}`,
            scheduleName: schedule.label ?? undefined,
            runCount: updatedSchedule.totalRuns,
          });
          const emailResult = await sendEmail({ to: user.email, ...email });
          console.log("[executor] email notification:", emailResult.success ? "sent" : emailResult.error);
        }
      } catch (err) {
        console.error("[executor] email notification failed:", err);
      }
    }

    console.log("[executor] done for schedule", schedule.id);
    return {
      executionId,
      runId: result.runId,
      success: result.success,
      conversationId,
    };
  },
);
