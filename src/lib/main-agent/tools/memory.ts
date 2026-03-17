import { z } from "zod";
import type { BetaToolResultContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const memoryCatalog: ToolCatalogEntry = {
  id: "memory",
  label: "Memory",
  runtime: "main_agent",
  kind: "anthropic_client",
  enabled: true,
  description: "Workspace memory persisted in Postgres and exposed as a Claude-style memory tool.",
};

function normalizeMemoryPath(path: string) {
  const cleaned = path.trim().replaceAll("\\", "/");
  const normalized = cleaned.startsWith("/memories") ? cleaned : `/memories/${cleaned.replace(/^\/+/, "")}`;

  if (!normalized.startsWith("/memories")) {
    throw new Error("Memory paths must stay within /memories.");
  }

  return normalized;
}

function getMemoryTitleFromPath(path: string) {
  const normalized = normalizeMemoryPath(path);
  const name = normalized.slice("/memories/".length).replace(/\/+/g, "-").replace(/\.md$/i, "");

  if (!name) {
    throw new Error("Memory file path must include a filename.");
  }

  return name;
}

async function findMemoryByPath(userId: string, path: string) {
  const key = getMemoryTitleFromPath(path);

  return prisma.memoryEntry.findFirst({
    where: { userId, key },
  });
}

const memoryCommandSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("view"),
    path: z.string().min(1),
    view_range: z.array(z.number().int()).max(2).optional(),
  }),
  z.object({
    command: z.literal("create"),
    path: z.string().min(1),
    file_text: z.string(),
  }),
  z.object({
    command: z.literal("insert"),
    path: z.string().min(1),
    insert_line: z.number().int().min(1),
    insert_text: z.string(),
  }),
  z.object({
    command: z.literal("str_replace"),
    path: z.string().min(1),
    old_str: z.string(),
    new_str: z.string(),
  }),
  z.object({
    command: z.literal("delete"),
    path: z.string().min(1),
  }),
  z.object({
    command: z.literal("rename"),
    old_path: z.string().min(1),
    new_path: z.string().min(1),
  }),
]);

type MemoryCommand = z.infer<typeof memoryCommandSchema>;

export function createMemoryTool(ctx: ToolRuntimeContext): BetaRunnableTool<MemoryCommand> {
  return {
    name: "memory",
    type: "memory_20250818",
    allowed_callers: ["direct"],
    strict: true,
    parse(input) {
      return memoryCommandSchema.parse(input);
    },
    async run(command) {
      try {
        let result: string | BetaToolResultContentBlockParam[];

        switch (command.command) {
          case "view": {
            const normalized = normalizeMemoryPath(command.path);

            if (normalized === "/memories" || normalized === "/memories/") {
              const entries = await prisma.memoryEntry.findMany({
                where: { userId: ctx.userId },
                orderBy: { updatedAt: "desc" },
                take: 50,
              });

              result = entries.length
                ? entries.map((entry) => `/memories/${entry.key}.md`).join("\n")
                : "No memory files saved yet.";
              break;
            }

            const entry = await findMemoryByPath(ctx.userId, normalized);

            if (!entry) {
              throw new Error(`Memory file not found: ${normalized}`);
            }

            const lines = entry.value.split("\n");
            const start = command.view_range?.[0] ? Math.max(command.view_range[0] - 1, 0) : 0;
            const end = command.view_range?.[1] ? Math.min(command.view_range[1], lines.length) : lines.length;
            result = lines.slice(start, end).join("\n");
            break;
          }
          case "create": {
            const key = getMemoryTitleFromPath(command.path);
            await prisma.memoryEntry.create({
              data: {
                userId: ctx.userId,
                conversationId: ctx.conversationId,
                key,
                value: command.file_text,
              },
            });
            result = `Created /memories/${key}.md`;
            break;
          }
          case "insert": {
            const entry = await findMemoryByPath(ctx.userId, command.path);

            if (!entry) {
              throw new Error(`Memory file not found: ${command.path}`);
            }

            const lines = entry.value.split("\n");
            lines.splice(Math.min(command.insert_line - 1, lines.length), 0, command.insert_text);

            await prisma.memoryEntry.update({
              where: { id: entry.id },
              data: { value: lines.join("\n") },
            });

            result = `Inserted text into ${command.path}`;
            break;
          }
          case "str_replace": {
            const entry = await findMemoryByPath(ctx.userId, command.path);

            if (!entry) {
              throw new Error(`Memory file not found: ${command.path}`);
            }

            await prisma.memoryEntry.update({
              where: { id: entry.id },
              data: { value: entry.value.replace(command.old_str, command.new_str) },
            });

            result = `Updated ${command.path}`;
            break;
          }
          case "delete": {
            const entry = await findMemoryByPath(ctx.userId, command.path);

            if (!entry) {
              throw new Error(`Memory file not found: ${command.path}`);
            }

            await prisma.memoryEntry.delete({ where: { id: entry.id } });

            result = `Deleted ${command.path}`;
            break;
          }
          case "rename": {
            const entry = await findMemoryByPath(ctx.userId, command.old_path);

            if (!entry) {
              throw new Error(`Memory file not found: ${command.old_path}`);
            }

            const key = getMemoryTitleFromPath(command.new_path);
            await prisma.memoryEntry.update({
              where: { id: entry.id },
              data: { key },
            });

            result = `Renamed ${command.old_path} to ${command.new_path}`;
            break;
          }
        }

        await ctx.emit("tool.call.completed", {
          toolName: "memory",
          toolRuntime: "anthropic_client",
          result: typeof result === "string" ? result.slice(0, 2000) : jsonResult(result).slice(0, 2000),
        });

        return result;
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "memory",
          toolRuntime: "anthropic_client",
          error: error instanceof Error ? error.message : "Unknown memory tool error",
        });
        throw error;
      }
    },
  };
}

