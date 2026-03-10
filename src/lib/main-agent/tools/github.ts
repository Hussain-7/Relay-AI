import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { connectRepoBinding, createPullRequestForBinding, createRemoteRepo, deleteRepoBinding, getGitHubConfigurationStatus, listKnownRepos, listGithubRepos, searchGithubRepos } from "@/lib/github/service";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const githubCatalog: ToolCatalogEntry = {
  id: "github",
  label: "GitHub actions",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "List, connect, create repos, and open pull requests through the control plane.",
};

export function createGithubListReposTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "github_list_repos",
    description: "List repo bindings already known to the workspace and GitHub app status.",
    inputSchema: z.object({}),
    async run() {
      try {
        const [connectedRepos, githubRepos] = await Promise.all([
          listKnownRepos(ctx.userId),
          listGithubRepos(ctx.userId),
        ]);
        await ctx.emit("tool.call.completed", {
          toolName: "github_list_repos",
          toolRuntime: "custom",
          connectedCount: connectedRepos.length,
          availableCount: githubRepos.length,
        });
        return jsonResult({
          configuration: getGitHubConfigurationStatus(),
          connectedRepos,
          availableGithubRepos: githubRepos,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_list_repos",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown GitHub list error",
        });
        throw error;
      }
    },
  });
}

export function createGithubConnectRepoTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
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
          toolRuntime: "custom",
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
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown GitHub connect error",
        });
        throw error;
      }
    },
  });
}

export function createGithubCreateRepoTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
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
          toolRuntime: "custom",
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
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown GitHub create error",
        });
        throw error;
      }
    },
  });
}

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

export function createGithubSearchReposTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "github_search_repos",
    description: "Search repositories on the user's GitHub account that the app has access to.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query to filter repos by name or description"),
    }),
    async run(input) {
      try {
        const repos = await searchGithubRepos(ctx.userId, input.query);
        await ctx.emit("tool.call.completed", {
          toolName: "github_search_repos",
          toolRuntime: "custom",
          resultCount: repos.length,
        });
        return jsonResult(repos);
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_search_repos",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown search error",
        });
        throw error;
      }
    },
  });
}

export function createGithubDeleteRepoBindingTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "github_disconnect_repo",
    description: "Remove a connected repository binding from this workspace.",
    inputSchema: z.object({
      repoBindingId: z.string().min(1).describe("The ID of the repo binding to remove"),
    }),
    async run(input) {
      try {
        await deleteRepoBinding(ctx.userId, input.repoBindingId);
        await ctx.emit("tool.call.completed", {
          toolName: "github_disconnect_repo",
          toolRuntime: "custom",
          repoBindingId: input.repoBindingId,
        });
        return jsonResult({ deleted: true, repoBindingId: input.repoBindingId });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_disconnect_repo",
          toolRuntime: "custom",
          error: error instanceof Error ? error.message : "Unknown delete error",
        });
        throw error;
      }
    },
  });
}
