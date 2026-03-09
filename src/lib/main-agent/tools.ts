import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaToolResultContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

import { startOrResumeCodingSession, pauseCodingSession, getLatestCodingSession } from "@/lib/coding/session-service";
import { connectRepoBinding, createPullRequestForBinding, createRemoteRepo, getGitHubConfigurationStatus, listKnownRepos } from "@/lib/github/service";
import { searchMemoryEntries, writeMemoryEntry } from "@/lib/memory/service";
import { prisma } from "@/lib/prisma";

interface ToolRuntimeContext {
  userId: string;
  conversationId: string;
  runId: string;
  emit: (type: "tool.call.completed" | "tool.call.failed", payload: Record<string, unknown>) => Promise<void>;
}

function jsonResult(value: unknown) {
  return JSON.stringify(value, null, 2);
}

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
    where: {
      userId,
      key,
    },
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

function createMemoryTool(ctx: ToolRuntimeContext): BetaRunnableTool<MemoryCommand> {
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
              data: {
                value: lines.join("\n"),
              },
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
              data: {
                value: entry.value.replace(command.old_str, command.new_str),
              },
            });

            result = `Updated ${command.path}`;
            break;
          }
          case "delete": {
            const entry = await findMemoryByPath(ctx.userId, command.path);

            if (!entry) {
              throw new Error(`Memory file not found: ${command.path}`);
            }

            await prisma.memoryEntry.delete({
              where: { id: entry.id },
            });

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
          resultPreview: typeof result === "string" ? result : jsonResult(result),
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

export function createMainAgentTools(ctx: ToolRuntimeContext) {
  const memorySearchTool = betaZodTool({
    name: "memory_search",
    description: "Search saved workspace memory entries relevant to the current task.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    async run(input) {
      try {
        const results = await searchMemoryEntries({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          query: input.query,
          limit: input.limit,
        });
        const payload = { toolName: "memory_search", toolRuntime: "custom_backend", resultCount: results.length };
        await ctx.emit("tool.call.completed", payload);
        return jsonResult(results);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "memory_search",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown memory search error",
        });
        throw error;
      }
    },
  });

  const memoryWriteTool = betaZodTool({
    name: "memory_write",
    description: "Persist a durable note to workspace memory.",
    inputSchema: z.object({
      title: z.string().min(1),
      content: z.string().min(1),
      tags: z.array(z.string()).optional(),
    }),
    async run(input) {
      try {
        const entry = await writeMemoryEntry({
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          title: input.title,
          content: input.content,
          tags: input.tags,
        });
        await ctx.emit("tool.call.completed", {
          toolName: "memory_write",
          toolRuntime: "custom_backend",
          memoryEntryId: entry.id,
        });
        return `Saved memory entry "${entry.key}".`;
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "memory_write",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown memory write error",
        });
        throw error;
      }
    },
  });

  const chatSearchTool = betaZodTool({
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

        await ctx.emit("tool.call.completed", {
          toolName: "chat_search",
          toolRuntime: "custom_backend",
          resultCount: runs.length,
        });

        return jsonResult(
          runs.map((run) => ({
            id: run.id,
            createdAt: run.createdAt.toISOString(),
            userPrompt: run.userPrompt,
            finalText: run.finalText,
          })),
        );
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "chat_search",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown chat search error",
        });
        throw error;
      }
    },
  });

  const githubListReposTool = betaZodTool({
    name: "github_list_repos",
    description: "List repo bindings already known to the workspace and GitHub app status.",
    inputSchema: z.object({}),
    async run() {
      try {
        const repos = await listKnownRepos(ctx.userId);
        await ctx.emit("tool.call.completed", {
          toolName: "github_list_repos",
          toolRuntime: "custom_backend",
          resultCount: repos.length,
        });

        return jsonResult({
          configuration: getGitHubConfigurationStatus(),
          repos,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_list_repos",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown GitHub list error",
        });
        throw error;
      }
    },
  });

  const githubConnectRepoTool = betaZodTool({
    name: "github_connect_repo",
    description: "Attach an existing GitHub repository to this chat.",
    inputSchema: z.object({
      repoFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
      installationId: z.string().optional(),
      defaultBranch: z.string().optional(),
    }),
    async run(input) {
      try {
        const binding = await connectRepoBinding({
          userId: ctx.userId,
          repoFullName: input.repoFullName,
          installationId: input.installationId,
          defaultBranch: input.defaultBranch,
        });

        await ctx.emit("tool.call.completed", {
          toolName: "github_connect_repo",
          toolRuntime: "custom_backend",
          repoBindingId: binding.id,
        });

        return jsonResult({
          repoBindingId: binding.id,
          repoFullName: binding.repoFullName,
          defaultBranch: binding.defaultBranch,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_connect_repo",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown GitHub connect error",
        });
        throw error;
      }
    },
  });

  const githubCreateRepoTool = betaZodTool({
    name: "github_create_repo",
    description: "Create a new GitHub repository or a provisional repo binding if the app is not fully configured.",
    inputSchema: z.object({
      owner: z.string().optional(),
      name: z.string().min(1),
      description: z.string().optional(),
      isPrivate: z.boolean().optional(),
    }),
    async run(input) {
      try {
        const binding = await createRemoteRepo({
          userId: ctx.userId,
          owner: input.owner,
          name: input.name,
          description: input.description,
          isPrivate: input.isPrivate,
        });

        await ctx.emit("tool.call.completed", {
          toolName: "github_create_repo",
          toolRuntime: "custom_backend",
          repoBindingId: binding.id,
        });

        return jsonResult({
          repoBindingId: binding.id,
          repoFullName: binding.repoFullName,
          defaultBranch: binding.defaultBranch,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_create_repo",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown GitHub create error",
        });
        throw error;
      }
    },
  });

  const codingSessionStartTool = betaZodTool({
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
          toolRuntime: "custom_backend",
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
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown coding session start error",
        });
        throw error;
      }
    },
  });

  const codingSessionStatusTool = betaZodTool({
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
          toolRuntime: "custom_backend",
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
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown coding status error",
        });
        throw error;
      }
    },
  });

  const codingSessionPauseTool = betaZodTool({
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
          toolRuntime: "custom_backend",
          codingSessionId: session.id,
        });

        return jsonResult({
          codingSessionId: session.id,
          status: session.status,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_session_pause",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown coding pause error",
        });
        throw error;
      }
    },
  });

  const codingSessionCreatePrTool = betaZodTool({
    name: "coding_session_create_pr",
    description: "Create a pull request for the repo bound to the current coding session.",
    inputSchema: z.object({
      repoBindingId: z.string(),
      title: z.string().min(1),
      body: z.string().default(""),
      head: z.string().min(1),
      base: z.string().optional(),
    }),
    async run(input) {
      try {
        const pullRequest = await createPullRequestForBinding({
          repoBindingId: input.repoBindingId,
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        });

        await ctx.emit("tool.call.completed", {
          toolName: "coding_session_create_pr",
          toolRuntime: "custom_backend",
          prUrl: pullRequest.url,
        });

        return jsonResult(pullRequest);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "coding_session_create_pr",
          toolRuntime: "custom_backend",
          error: error instanceof Error ? error.message : "Unknown PR create error",
        });
        throw error;
      }
    },
  });

  return [
    chatSearchTool,
    githubListReposTool,
    githubConnectRepoTool,
    githubCreateRepoTool,
    codingSessionStartTool,
    codingSessionStatusTool,
    codingSessionPauseTool,
    codingSessionCreatePrTool,
  ];
}
