import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { createPullRequestForBinding } from "@/lib/github/service";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const githubCatalog: ToolCatalogEntry = {
  id: "github",
  label: "GitHub actions",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Create pull requests from coding session branches.",
};

export function createGithubCreatePrTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "coding_session_create_pr",
    description: "Create a pull request from a coding session branch.",
    inputSchema: z.object({
      repoBindingId: z.string().min(1),
      title: z.string().min(1),
      body: z.string().default(""),
      head: z.string().min(1),
      base: z.string().optional(),
    }),
    async run(input) {
      try {
        const pullRequest = await createPullRequestForBinding({
          userId: ctx.userId,
          repoBindingId: input.repoBindingId,
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        });
        await ctx.emit("tool.call.completed", {
          toolName: "coding_session_create_pr",
          toolRuntime: "custom",
          prUrl: pullRequest.url,
          resultPreview: `PR #${pullRequest.number}: ${pullRequest.url}`,
        });
        return jsonResult(pullRequest);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_session_create_pr",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown PR create error",
        });
        throw error;
      }
    },
  });
}

