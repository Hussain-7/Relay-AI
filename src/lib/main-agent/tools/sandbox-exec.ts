import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Sandbox } from "@e2b/code-interpreter";

import { env, hasE2bConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const sandboxExecCatalog: ToolCatalogEntry = {
  id: "sandbox_exec",
  label: "Sandbox execute",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Execute shell commands in the E2B coding sandbox.",
};

export function createSandboxExecTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "sandbox_exec",
    description:
      "Run a shell command in the ACTIVE E2B sandbox. Use this ONLY after a coding session is already running (via coding_agent). Good for: checking git status, running tests, listing files, installing packages, or verifying changes. Do NOT use this as the first tool — always start a coding session first. Do NOT confuse this with the built-in code_execution tool — code_execution runs short-lived scripts server-side, while sandbox_exec runs commands in the persistent E2B sandbox where the repo is cloned.",
    inputSchema: z.object({
      command: z.string().min(1).describe("The shell command to execute"),
      workspacePath: z.string().optional().describe("Working directory (defaults to the session workspace)"),
      timeoutMs: z.number().optional().describe("Timeout in ms (default 30s)"),
    }),
    async run(input) {
      try {
        if (!hasE2bConfig()) {
          throw new Error("E2B_API_KEY is required.");
        }

        // Find the active coding session for this conversation
        const session = await prisma.codingSession.findFirst({
          where: {
            conversationId: ctx.conversationId,
            status: { in: ["READY", "RUNNING"] },
          },
          orderBy: { updatedAt: "desc" },
        });

        if (!session?.sandboxId) {
          throw new Error("No active coding session. Start one first with coding_agent.");
        }

        const sandbox = await Sandbox.connect(session.sandboxId, {
          apiKey: env.E2B_API_KEY,
          timeoutMs: 1000 * 60 * 20,
        });

        const cwd = input.workspacePath ?? session.workspacePath ?? "/workspace";
        const result = await sandbox.commands.run(
          `cd "${cwd}" && ${input.command}`,
          { timeoutMs: input.timeoutMs ?? 30000 },
        );

        const output = {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 2000),
        };

        await ctx.emit("tool.call.completed", {
          toolName: "sandbox_exec",
          toolRuntime: "custom",
          input,
          exitCode: result.exitCode,
          result: (result.stdout || result.stderr).slice(0, 2000),
        });

        return jsonResult(output);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "sandbox_exec",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Unknown sandbox exec error",
        });
        throw error;
      }
    },
  });
}
