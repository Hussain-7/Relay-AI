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
      "Execute a shell command in the active E2B coding sandbox. Use this to read/write files, run git commands, install packages, or any other shell operation in the cloned repository workspace.",
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
          throw new Error("No active coding session. Start one first with coding_session_start_or_continue.");
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
          exitCode: result.exitCode,
          resultPreview: result.stdout.slice(0, 200) || result.stderr.slice(0, 200),
        });

        return jsonResult(output);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "sandbox_exec",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown sandbox exec error",
        });
        throw error;
      }
    },
  });
}

export function createSandboxWriteFileTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "sandbox_write_file",
    description: "Write content to a file in the E2B coding sandbox. Creates parent directories automatically.",
    inputSchema: z.object({
      filePath: z.string().min(1).describe("Absolute path or relative to workspace"),
      content: z.string().describe("File content to write"),
    }),
    async run(input) {
      try {
        if (!hasE2bConfig()) {
          throw new Error("E2B_API_KEY is required.");
        }

        const session = await prisma.codingSession.findFirst({
          where: {
            conversationId: ctx.conversationId,
            status: { in: ["READY", "RUNNING"] },
          },
          orderBy: { updatedAt: "desc" },
        });

        if (!session?.sandboxId) {
          throw new Error("No active coding session.");
        }

        const sandbox = await Sandbox.connect(session.sandboxId, {
          apiKey: env.E2B_API_KEY,
          timeoutMs: 1000 * 60 * 20,
        });

        // Resolve path relative to workspace if not absolute
        const fullPath = input.filePath.startsWith("/")
          ? input.filePath
          : `${session.workspacePath}/${input.filePath}`;

        // Ensure parent directory exists
        const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dir) {
          await sandbox.commands.run(`mkdir -p "${dir}"`);
        }

        await sandbox.files.write(fullPath, input.content);

        await ctx.emit("tool.call.completed", {
          toolName: "sandbox_write_file",
          toolRuntime: "custom",
          filePath: fullPath,
          bytes: input.content.length,
        });

        return jsonResult({ written: fullPath, bytes: input.content.length });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "sandbox_write_file",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown write error",
        });
        throw error;
      }
    },
  });
}
