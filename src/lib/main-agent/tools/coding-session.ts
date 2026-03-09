import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { startOrResumeCodingSession, pauseCodingSession, getLatestCodingSession } from "@/lib/coding/session-service";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const codingSessionCatalog: ToolCatalogEntry[] = [
  {
    id: "coding_session",
    label: "Coding session control",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Provision, pause, resume, and inspect remote coding workspaces.",
  },
  {
    id: "bash",
    label: "Bash",
    runtime: "coding_agent",
    kind: "claude_code_builtin",
    enabled: true,
    description: "Claude Code shell access inside the remote coding workspace.",
  },
  {
    id: "text_editor",
    label: "Text editor",
    runtime: "coding_agent",
    kind: "claude_code_builtin",
    enabled: true,
    description: "Claude Code file editing inside the remote coding workspace.",
  },
];

export function createCodingSessionStartTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "coding_session_start_or_continue",
    description: "Provision or resume the repo-backed coding workspace for this chat.",
    inputSchema: z.object({
      repoBindingId: z.string().optional(),
      taskBrief: z.string().min(1),
      branchStrategy: z.string().optional(),
    }),
    async run(input) {
      try {
        const session = await startOrResumeCodingSession({
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          runId: ctx.runId,
          repoBindingId: input.repoBindingId,
          taskBrief: input.taskBrief,
          branchStrategy: input.branchStrategy,
        });
        await ctx.emit("tool.call.completed", {
          toolName: "coding_session_start_or_continue",
          toolRuntime: "custom",
          codingSessionId: session.id,
          workspacePath: session.workspacePath,
        });
        return jsonResult({
          codingSessionId: session.id,
          status: session.status,
          workspacePath: session.workspacePath,
          branch: session.branch,
          repoBindingId: session.repoBindingId,
          note: "The workspace is provisioned. The dedicated remote Claude Code runner handoff remains a separate control-plane step.",
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_session_start_or_continue",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown coding session start error",
        });
        throw error;
      }
    },
  });
}

export function createCodingSessionStatusTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "coding_session_status",
    description: "Get the latest coding workspace status for this chat.",
    inputSchema: z.object({
      codingSessionId: z.string().optional(),
    }),
    async run(input) {
      try {
        const session =
          input.codingSessionId == null
            ? await getLatestCodingSession(ctx.conversationId)
            : await prisma.codingSession.findUnique({
                where: { id: input.codingSessionId },
                include: { repoBinding: true },
              });
        await ctx.emit("tool.call.completed", {
          toolName: "coding_session_status",
          toolRuntime: "custom",
          hasSession: Boolean(session),
        });
        return jsonResult(
          session
            ? {
                id: session.id,
                status: session.status,
                workspacePath: session.workspacePath,
                branch: session.branch,
                sandboxId: session.sandboxId,
                repoBindingId: session.repoBindingId,
              }
            : { status: "none" },
        );
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_session_status",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown coding status error",
        });
        throw error;
      }
    },
  });
}

export function createCodingSessionPauseTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "coding_session_pause",
    description: "Pause the current coding workspace to save resources.",
    inputSchema: z.object({
      codingSessionId: z.string(),
    }),
    async run(input) {
      try {
        const session = await pauseCodingSession({
          codingSessionId: input.codingSessionId,
          conversationId: ctx.conversationId,
          runId: ctx.runId,
        });
        await ctx.emit("tool.call.completed", {
          toolName: "coding_session_pause",
          toolRuntime: "custom",
          codingSessionId: session.id,
        });
        return jsonResult({
          codingSessionId: session.id,
          status: session.status,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_session_pause",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown coding pause error",
        });
        throw error;
      }
    },
  });
}
