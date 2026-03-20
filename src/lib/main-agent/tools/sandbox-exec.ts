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
      "Run a shell command in the ACTIVE E2B sandbox. Use this ONLY after a coding session is already running (via coding_agent). Good for: checking git status, running tests, listing files, installing packages, starting dev servers, or verifying changes. Do NOT use this as the first tool — always start a coding session first. Do NOT confuse this with the built-in code_execution tool — code_execution runs short-lived scripts server-side, while sandbox_exec runs commands in the persistent E2B sandbox where the repo is cloned.\n" +
      "For long-running processes (dev servers, watchers, etc.), set background=true — the command starts in the background and returns immediately without waiting for it to finish.",
    inputSchema: z.object({
      command: z.string().min(1).describe("The shell command to execute"),
      workspacePath: z.string().optional().describe("Working directory (defaults to the session workspace)"),
      timeoutMs: z.number().optional().describe("Timeout in ms (default 30s). Ignored when background=true."),
      background: z.boolean().optional().describe("Run the command in the background (nohup). Use for long-running processes like dev servers. Returns immediately."),
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

        // Background mode: start process with nohup and return immediately
        if (input.background) {
          const bgCmd = `cd "${cwd}" && nohup ${input.command} > /tmp/bg-cmd.log 2>&1 & echo $!`;
          let pid = "";
          try {
            const result = await sandbox.commands.run(bgCmd, { timeoutMs: 5000 });
            pid = result.stdout.trim();
          } catch (cmdError) {
            const err = cmdError as { stdout?: string; message?: string };
            pid = err.stdout?.trim() ?? "";
          }

          const output = {
            background: true,
            pid,
            logFile: "/tmp/bg-cmd.log",
            message: `Command started in background (PID ${pid}). Check logs with: cat /tmp/bg-cmd.log`,
          };

          await ctx.emit("tool.call.completed", {
            toolName: "sandbox_exec",
            toolRuntime: "custom",
            input,
            result: JSON.stringify(output).slice(0, 2000),
          });

          return jsonResult(output);
        }

        // Foreground mode: run and wait for completion
        let stdout = "";
        let stderr = "";
        let exitCode = 0;
        try {
          const result = await sandbox.commands.run(
            `cd "${cwd}" && ${input.command}`,
            { timeoutMs: input.timeoutMs ?? 30000 },
          );
          stdout = result.stdout;
          stderr = result.stderr;
          exitCode = result.exitCode;
        } catch (cmdError) {
          const err = cmdError as { stdout?: string; stderr?: string; exitCode?: number; message?: string };
          stdout = err.stdout ?? "";
          stderr = err.stderr ?? err.message ?? String(cmdError);
          exitCode = err.exitCode ?? 1;
        }

        const output = {
          exitCode,
          stdout: stdout.slice(0, 4000),
          stderr: stderr.slice(0, 2000),
        };

        const isFailure = exitCode !== 0;
        await ctx.emit(isFailure ? "tool.call.failed" : "tool.call.completed", {
          toolName: "sandbox_exec",
          toolRuntime: "custom",
          input,
          exitCode,
          result: (stdout || stderr).slice(0, 2000),
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
