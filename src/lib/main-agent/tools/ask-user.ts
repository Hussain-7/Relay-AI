import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { checkStopFlag } from "@/lib/run-stop";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const askUserCatalog: ToolCatalogEntry = {
  id: "ask_user",
  label: "Ask user",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Pause and ask the user a clarifying question before proceeding.",
};

const POLL_INTERVAL_MS = 1500;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createAskUserTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "ask_user",
    description:
      "Pause and ask the user a clarifying question before proceeding. You can provide selectable options and/or allow freeform text input. Use SPARINGLY — only when the answer genuinely affects what you do next. Do not ask unnecessary questions when a reasonable default exists.",
    inputSchema: z.object({
      question: z.string().min(1).describe("The question to display to the user"),
      options: z.array(z.string()).optional().describe("Selectable option buttons for the user to choose from"),
      allowFreeform: z
        .boolean()
        .optional()
        .describe("Whether to show a freeform text input. Defaults to true when no options are provided."),
    }),
    async run(input) {
      const allowFreeform = input.allowFreeform ?? (input.options == null || input.options.length === 0);

      try {
        // 1. Create the RunApproval record
        const approval = await prisma.runApproval.create({
          data: {
            runId: ctx.runId,
            kind: "ask_user",
            title: input.question,
            status: "PENDING",
            proposalJson: {
              options: input.options ?? null,
              allowFreeform,
            },
          },
        });

        // 2. Emit approval.requested event
        ctx.emitProgress("approval.requested", "main_agent", {
          approvalId: approval.id,
          question: input.question,
          options: input.options ?? null,
          allowFreeform,
        });

        // 3. Poll for resolution
        const startTime = Date.now();

        while (Date.now() - startTime < TIMEOUT_MS) {
          await sleep(POLL_INTERVAL_MS);

          // Check if the run was stopped
          const stopped = await checkStopFlag(ctx.runId);
          if (stopped) {
            // Auto-reject the approval on stop
            await prisma.runApproval.update({
              where: { id: approval.id },
              data: {
                status: "REJECTED",
                responseJson: { reason: "run_stopped" },
                resolvedAt: new Date(),
              },
            });
            throw new Error("Run was stopped while waiting for user response.");
          }

          // Check for resolution
          const updated = await prisma.runApproval.findUnique({
            where: { id: approval.id },
          });

          if (updated && updated.status !== "PENDING") {
            const responseJson = (updated.responseJson as Record<string, unknown>) ?? {};

            // 4. Emit approval.resolved event
            ctx.emitProgress("approval.resolved", "user", {
              approvalId: approval.id,
              status: updated.status,
              response: responseJson,
            });

            await ctx.emit("tool.call.completed", {
              toolName: "ask_user",
              toolRuntime: "custom",
              input,
              result: JSON.stringify(responseJson),
            });

            const answer =
              typeof responseJson.answer === "string"
                ? responseJson.answer
                : typeof responseJson.selectedOption === "string"
                  ? responseJson.selectedOption
                  : JSON.stringify(responseJson);

            return jsonResult({
              status: updated.status === "APPROVED" ? "answered" : "rejected",
              answer,
            });
          }
        }

        // 5. Timeout — auto-reject
        await prisma.runApproval.update({
          where: { id: approval.id },
          data: {
            status: "REJECTED",
            responseJson: { reason: "timeout" },
            resolvedAt: new Date(),
          },
        });

        ctx.emitProgress("approval.resolved", "system", {
          approvalId: approval.id,
          status: "REJECTED",
          response: { reason: "timeout" },
        });

        await ctx.emit("tool.call.completed", {
          toolName: "ask_user",
          toolRuntime: "custom",
          input,
          result: "User did not respond (timed out after 5 minutes)",
        });

        return jsonResult({
          status: "timeout",
          answer: "User did not respond within the time limit.",
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "ask_user",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Unknown ask_user error",
        });
        throw error;
      }
    },
  });
}
