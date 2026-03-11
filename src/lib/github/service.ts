import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";

export function getGitHubConfigurationStatus() {
  return {
    configured: hasGitHubAppConfig(),
    slug: env.GITHUB_APP_SLUG ?? null,
    installUrl: hasGitHubAppConfig() ? `/api/github/install` : null,
  };
}

async function getInstallationClient(userId: string) {
  if (!hasGitHubAppConfig()) return null;

  const installation = await prisma.githubInstallation.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  if (!installation) return null;

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: env.GITHUB_APP_PRIVATE_KEY!,
      installationId: Number(installation.installationId),
    },
  });
}

export async function listGithubRepos(userId: string) {
  const client = await getInstallationClient(userId);
  if (!client) return [];

  try {
    const { data } = await client.request("GET /installation/repositories", {
      per_page: 100,
    });

    return data.repositories.map((repo: { full_name: string; name: string; default_branch: string; private: boolean; description: string | null }) => ({
      fullName: repo.full_name,
      name: repo.name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      description: repo.description,
    }));
  } catch {
    return [];
  }
}

export async function searchGithubRepos(userId: string, query: string) {
  const client = await getInstallationClient(userId);
  if (!client) return [];

  try {
    // Search within repos the installation has access to
    const { data } = await client.request("GET /installation/repositories", {
      per_page: 100,
    });

    const lowerQuery = query.toLowerCase();
    return data.repositories
      .filter((repo: { full_name: string; name: string; description: string | null }) =>
        repo.full_name.toLowerCase().includes(lowerQuery) ||
        repo.name.toLowerCase().includes(lowerQuery) ||
        (repo.description ?? "").toLowerCase().includes(lowerQuery),
      )
      .map((repo: { full_name: string; name: string; default_branch: string; private: boolean; description: string | null; clone_url: string }) => ({
        fullName: repo.full_name,
        name: repo.name,
        defaultBranch: repo.default_branch,
        isPrivate: repo.private,
        description: repo.description,
        cloneUrl: repo.clone_url,
      }));
  } catch {
    return [];
  }
}

export async function deleteRepoBinding(userId: string, repoBindingId: string) {
  const deleted = await prisma.repoBinding.deleteMany({
    where: { id: repoBindingId, userId },
  });

  if (!deleted.count) {
    throw new Error("Repo binding not found or not owned by this user.");
  }
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
  skipVerification?: boolean;
}) {
  const [repoOwner, repoName] = input.repoFullName.split("/");

  if (!repoOwner || !repoName) {
    throw new Error("Expected repoFullName in owner/name format.");
  }

  // Verify the repo exists and is accessible via the GitHub App
  if (!input.skipVerification) {
    const client = await getInstallationClient(input.userId);
    if (client) {
      try {
        const { data: repo } = await client.request("GET /repos/{owner}/{repo}", {
          owner: repoOwner,
          repo: repoName,
        });
        // Use verified data from GitHub
        input.defaultBranch = repo.default_branch;
      } catch {
        throw new Error(
          `Repository "${input.repoFullName}" is not accessible. Make sure the GitHub App is installed and has access to this repo.`,
        );
      }
    }
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
  const client = await getInstallationClient(input.userId);

  if (!client) {
    return connectRepoBinding({
      userId: input.userId,
      repoFullName: `${input.owner ?? "pending"}/${input.name}`,
      defaultBranch: "main",
    });
  }

  // Get the account login from the installation to determine if it's a user or org
  const installation = await prisma.githubInstallation.findFirst({
    where: { userId: input.userId },
    orderBy: { updatedAt: "desc" },
  });

  const owner = input.owner ?? installation?.accountLogin;

  if (!owner) {
    throw new Error("Could not determine GitHub account. Please specify an owner.");
  }

  // GitHub Apps with installation tokens must use the org endpoint.
  // For personal accounts, this also works via the same endpoint pattern
  // since GitHub treats user accounts similarly for this API.
  try {
    const response = await client.request("POST /orgs/{org}/repos", {
      org: owner,
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
  } catch (orgError) {
    // If org endpoint fails (personal account), try the user repos endpoint
    // This requires the installation to have repo creation permissions
    try {
      const response = await client.request("POST /user/repos", {
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
    } catch {
      // Both failed — throw a clear error
      throw new Error(
        `Cannot create repository "${input.name}" under "${owner}". ` +
        `GitHub App installations cannot create repos in personal accounts — only in organizations. ` +
        `Either specify an organization as the owner, or create the repo manually on GitHub and use the connect_repo tool instead.`,
      );
    }
  }
}

export async function createPullRequestForBinding(input: {
  repoBindingId: string;
  userId: string;
  title: string;
  body: string;
  head: string;
  base?: string;
}) {
  const binding = await prisma.repoBinding.findUnique({
    where: { id: input.repoBindingId },
  });

  if (!binding) {
    throw new Error("Repo binding not found.");
  }

  const client = await getInstallationClient(input.userId);

  if (!client) {
    throw new Error("GitHub App is not installed. Visit /api/github/install to connect your GitHub account.");
  }

  const response = await client.request("POST /repos/{owner}/{repo}/pulls", {
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

/**
 * Decrypt and return the user's GitHub OAuth access token.
 * Auto-refreshes if expired using the stored refresh token.
 * Returns null if no user token is stored.
 */
export async function getGitHubUserToken(userId: string): Promise<string | null> {
  const installation = await prisma.githubInstallation.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  if (!installation?.encryptedUserToken || !installation.userTokenIv) {
    return null;
  }

  // Check if token needs refresh
  if (installation.userTokenExpiresAt && installation.userTokenExpiresAt < new Date()) {
    if (
      !installation.encryptedRefreshToken ||
      !installation.refreshTokenIv ||
      !env.GITHUB_APP_CLIENT_ID ||
      !env.GITHUB_APP_CLIENT_SECRET
    ) {
      return null;
    }

    const refreshToken = decryptToken(
      installation.encryptedRefreshToken,
      installation.refreshTokenIv,
    );

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_APP_CLIENT_ID,
        client_secret: env.GITHUB_APP_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) return null;

    const { encrypted: newEncToken, iv: newTokenIv } = encryptToken(data.access_token);
    const updateData: {
      encryptedUserToken: string;
      userTokenIv: string;
      userTokenExpiresAt: Date | null;
      encryptedRefreshToken?: string;
      refreshTokenIv?: string;
    } = {
      encryptedUserToken: newEncToken,
      userTokenIv: newTokenIv,
      userTokenExpiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
    };

    if (data.refresh_token) {
      const { encrypted: newEncRefresh, iv: newRefreshIv } = encryptToken(data.refresh_token);
      updateData.encryptedRefreshToken = newEncRefresh;
      updateData.refreshTokenIv = newRefreshIv;
    }

    await prisma.githubInstallation.update({
      where: { id: installation.id },
      data: updateData,
    });

    return data.access_token;
  }

  return decryptToken(installation.encryptedUserToken, installation.userTokenIv);
}

/**
 * Get a fresh GitHub App installation token for the user.
 * These tokens expire after 1 hour.
 */
export async function getGitHubInstallationToken(userId: string): Promise<string | null> {
  if (!hasGitHubAppConfig()) return null;

  const installation = await prisma.githubInstallation.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  if (!installation) return null;

  const appClient = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID!,
      privateKey: env.GITHUB_APP_PRIVATE_KEY!,
      installationId: Number(installation.installationId),
    },
  });

  const { data: tokenData } = await appClient.request(
    "POST /app/installations/{installation_id}/access_tokens",
    { installation_id: Number(installation.installationId) },
  );

  return tokenData.token;
}

/**
 * Get the best available GitHub token for a user.
 * Prefers user access token (from OAuth), falls back to installation token.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const userToken = await getGitHubUserToken(userId);
  if (userToken) return userToken;
  return getGitHubInstallationToken(userId);
}
