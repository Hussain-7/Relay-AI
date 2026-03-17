import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { startOrResumeCodingSession, runCodingTask } from "@/lib/coding/session-service";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const codingSessionCatalog: ToolCatalogEntry[] = [
  {
    id: "coding_agent",
    label: "Coding agent",
    runtime: "main_agent",
    kind: "custom_backend",
    enabled: true,
    description: "Run a coding agent in a remote E2B sandbox with full repo access.",
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

export function createCodingAgentTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "coding_agent",
    description: "Start or resume a remote coding session in an E2B cloud sandbox. Use this when the user asks you to write code, fix bugs, implement features, refactor, or any task that requires reading/writing files in a repository. This provisions a sandbox, clones the linked GitHub repo, and runs a coding agent (Claude Code) that has full filesystem access with Read, Write, Edit, Bash, Git, etc. The coding agent can also create PRs and push commits. Do NOT use your built-in code_execution tool for repository work — that is only for short-lived analysis/data scripts. Always use this tool for real coding tasks.",
    inputSchema: z.object({
      taskBrief: z.string().min(1).describe("Clear description of the coding task to perform"),
      branchStrategy: z.string().optional().describe( "Branch naming strategy (defaults to chat/{conversationId})"),
    }),
    async run(input) {
      try {
        // Always resolve repoBindingId from the conversation's linked repo
        const conv = await prisma.conversation.findUnique({
          where: { id: ctx.conversationId },
        });
        const repoBindingId = conv?.repoBindingId ?? undefined;

        // Progress: provisioning
        ctx.emitProgress("coding.session.created", "system", {
          message: "Provisioning sandbox...",
        });

        // 1. Provision or resume the sandbox
        const session = await startOrResumeCodingSession({
          conversationId: ctx.conversationId,
          userId: ctx.userId,
          runId: ctx.runId,
          repoBindingId,
          taskBrief: input.taskBrief,
          branchStrategy: input.branchStrategy,
        });

        // Progress: session ready
        ctx.emitProgress("coding.session.ready", "system", {
          codingSessionId: session.id,
          sandboxId: session.sandboxId,
          message: session.sandboxId ? "Sandbox connected" : "Session provisioned",
        });

        // 2. Link coding session to agent run
        await prisma.agentRun.update({
          where: { id: ctx.runId },
          data: { codingSessionId: session.id },
        });

        // 3. Clone repo + run the coding agent with the task
        const taskResult = await runCodingTask({
          codingSessionId: session.id,
          conversationId: ctx.conversationId,
          runId: ctx.runId,
          userId: ctx.userId,
          taskBrief: input.taskBrief,
          onProgress: ctx.emitProgress,
        });

        await ctx.emit("tool.call.completed", {
          toolName: "coding_agent",
          toolRuntime: "custom",
          input,
          codingSessionId: session.id,
          sandboxId: taskResult.sandboxId,
          workspacePath: taskResult.workspacePath,
          status: taskResult.exitCode === 0 ? "completed" : "failed",
          eventCount: taskResult.eventCount,
          result: taskResult.result.slice(0, 2000),
        });

        return jsonResult({
          codingSessionId: session.id,
          status: taskResult.exitCode === 0 ? "completed" : "failed",
          workspacePath: taskResult.workspacePath,
          branch: taskResult.branch,
          repoFullName: taskResult.repoFullName,
          result: taskResult.result,
          agentSessionId: taskResult.sessionId,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_agent",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Unknown coding session start error",
        });
        throw error;
      }
    },
  });
}
