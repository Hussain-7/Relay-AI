import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";

function createGithubAppClient() {
  if (!hasGitHubAppConfig()) {
    return null;
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: env.GITHUB_APP_PRIVATE_KEY!,
    },
  });
}

export function getGitHubConfigurationStatus() {
  return {
    configured: hasGitHubAppConfig(),
    slug: env.GITHUB_APP_SLUG ?? null,
  };
}

export async function listKnownRepos(userId: string) {
  const bindings = await prisma.repoBinding.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  return bindings.map((binding) => ({
    id: binding.id,
    repoFullName: binding.repoFullName,
    defaultBranch: binding.defaultBranch,
    installationId: binding.installationId,
    metadataJson: binding.metadataJson,
  }));
}

export async function connectRepoBinding(input: {
  userId: string;
  repoFullName: string;
  installationId?: string | null;
  defaultBranch?: string | null;
}) {
  const [repoOwner, repoName] = input.repoFullName.split("/");

  if (!repoOwner || !repoName) {
    throw new Error("Expected repoFullName in owner/name format.");
  }

  return prisma.repoBinding.upsert({
    where: {
      userId_provider_repoFullName: {
        userId: input.userId,
        provider: "GITHUB",
        repoFullName: input.repoFullName,
      },
    },
    update: {
      installationId: input.installationId,
      defaultBranch: input.defaultBranch ?? "main",
    },
    create: {
      userId: input.userId,
      provider: "GITHUB",
      installationId: input.installationId,
      repoOwner,
      repoName,
      repoFullName: input.repoFullName,
      defaultBranch: input.defaultBranch ?? "main",
    },
  });
}

export async function createRemoteRepo(input: {
  userId: string;
  owner?: string;
  name: string;
  description?: string;
  isPrivate?: boolean;
}) {
  const appClient = createGithubAppClient();

  if (!appClient || !input.owner) {
    return connectRepoBinding({
      userId: input.userId,
      repoFullName: `${input.owner ?? "pending"}/${input.name}`,
      defaultBranch: "main",
    });
  }

  const response = await appClient.request("POST /orgs/{org}/repos", {
    org: input.owner,
    name: input.name,
    description: input.description,
    private: input.isPrivate ?? true,
    auto_init: true,
  });

  return connectRepoBinding({
    userId: input.userId,
    repoFullName: response.data.full_name,
    defaultBranch: response.data.default_branch,
  });
}

export async function createPullRequestForBinding(input: {
  repoBindingId: string;
  title: string;
  body: string;
  head: string;
  base?: string;
}) {
  const appClient = createGithubAppClient();

  if (!appClient) {
    throw new Error("GitHub App is not fully configured.");
  }

  const binding = await prisma.repoBinding.findUnique({
    where: { id: input.repoBindingId },
  });

  if (!binding) {
    throw new Error("Repo binding not found.");
  }

  const response = await appClient.request("POST /repos/{owner}/{repo}/pulls", {
    owner: binding.repoOwner,
    repo: binding.repoName,
    title: input.title,
    body: input.body,
    head: input.head,
    base: input.base ?? binding.defaultBranch ?? "main",
  });

  return {
    number: response.data.number,
    url: response.data.html_url,
  };
}
