import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const chatSearchCatalog: ToolCatalogEntry = {
  id: "chat_search",
  label: "Chat search",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Search prior prompts and responses in the current chat.",
};

export function createChatSearchTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "chat_search",
    description: "Search prior user prompts and assistant answers in this conversation.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    async run(input) {
      try {
        const runs = await prisma.agentRun.findMany({
          where: {
            conversationId: ctx.conversationId,
            OR: [
              { userPrompt: { contains: input.query, mode: "insensitive" } },
              { finalText: { contains: input.query, mode: "insensitive" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: input.limit ?? 5,
        });

        const result = runs.map((run) => ({
          id: run.id,
          createdAt: run.createdAt.toISOString(),
          userPrompt: run.userPrompt,
          finalText: run.finalText,
        }));

        await ctx.emit("tool.call.completed", {
          toolName: "chat_search",
          toolRuntime: "custom",
          resultCount: runs.length,
          resultPreview: jsonResult(result),
        });

        return jsonResult(result);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "chat_search",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown chat search error",
        });
        throw error;
      }
    },
  });
}
