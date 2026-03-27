import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { hasGitHubAppConfig } from "@/lib/env";
import { createRemoteRepo } from "@/lib/github/service";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const githubCatalog: ToolCatalogEntry = {
  id: "github_create_repo",
  label: "Create GitHub repo",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Create a new GitHub repository and link it to the conversation.",
};

export function createGithubCreateRepoTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "github_create_repo",
    description:
      "Create a new GitHub repository and automatically link it to this conversation. " +
      "After creation, the repo is ready for coding_agent to clone and work on. " +
      "Use this when the user asks to create a new project/repo on GitHub. " +
      "Requires the GitHub App to be installed. The repo is created as private by default with an initial commit.",
    inputSchema: z.object({
      name: z.string().min(1).describe("Repository name (e.g. 'my-project')"),
      description: z.string().optional().describe("Short repository description"),
      isPrivate: z
        .boolean()
        .optional()
        .describe(
          "Whether the repo is private (default: true). ALWAYS create private repos unless the user explicitly asks for public.",
        ),
      owner: z.string().optional().describe("GitHub org or user to create under (defaults to the installed account)"),
    }),
    async run(input) {
      try {
        if (!hasGitHubAppConfig()) {
          throw new Error(
            "GitHub App is not configured. Ask the user to install the GitHub App from the profile menu.",
          );
        }

        const binding = await createRemoteRepo({
          userId: ctx.userId,
          name: input.name,
          description: input.description,
          isPrivate: input.isPrivate,
          owner: input.owner,
        });

        // Auto-link the new repo to the current conversation
        await prisma.conversation.update({
          where: { id: ctx.conversationId },
          data: { repoBindingId: binding.id },
        });

        await ctx.emit("tool.call.completed", {
          toolName: "github_create_repo",
          toolRuntime: "custom",
          input,
          result: `Repository ${binding.repoFullName} created (branch: ${binding.defaultBranch ?? "main"})`,
        });

        return jsonResult({
          success: true,
          repoFullName: binding.repoFullName,
          defaultBranch: binding.defaultBranch,
          linkedToConversation: true,
          message: `Repository ${binding.repoFullName} created and linked. You can now use coding_agent to work on it.`,
        });
      } catch (error) {
        await ctx.emit("tool.call.failed", {
          toolName: "github_create_repo",
          toolRuntime: "custom",
          input,
          error: error instanceof Error ? error.message : "Unknown error creating repo",
        });
        throw error;
      }
    },
  });
}
