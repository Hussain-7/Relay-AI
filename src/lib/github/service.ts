import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";
import { getCached, invalidateCache } from "@/lib/server-cache";

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

export type RepoListItem = {
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  isPrivate: boolean;
  description: string | null;
  updatedAt: string;
};

/**
 * Fetch ALL repos accessible to the user (up to 500).
 * Tries user OAuth token first (sees all user repos), falls back to installation token.
 * Paginates automatically.
 */
export async function listGithubRepos(userId: string): Promise<RepoListItem[]> {
  const repos: RepoListItem[] = [];

  // Try user OAuth token first — sees ALL repos
  const userToken = await getGitHubUserToken(userId);
  if (userToken) {
    const userClient = new Octokit({ auth: userToken });
    let page = 1;
    const perPage = 100;
    const maxPages = 5; // 500 repos max

    while (page <= maxPages) {
      const { data } = await userClient.request("GET /user/repos", {
        per_page: perPage,
        page,
        sort: "updated",
        affiliation: "owner,collaborator,organization_member",
      });

      for (const repo of data) {
        repos.push({
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner?.login ?? repo.full_name.split("/")[0],
          defaultBranch: repo.default_branch ?? "main",
          isPrivate: repo.private,
          description: repo.description,
          updatedAt: repo.updated_at ?? new Date().toISOString(),
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    return repos;
  }

  // Fallback: installation token (only sees app-installed repos)
  const client = await getInstallationClient(userId);
  if (!client) {
    throw new Error("GitHub App is not installed. Visit the settings to connect your GitHub account.");
  }

  let page = 1;
  const perPage = 100;
  const maxPages = 5;

  while (page <= maxPages) {
    const { data } = await client.request("GET /installation/repositories", {
      per_page: perPage,
      page,
    });

    for (const repo of data.repositories) {
      repos.push({
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.full_name.split("/")[0],
        defaultBranch: repo.default_branch,
        isPrivate: repo.private,
        description: repo.description,
        updatedAt: (repo as unknown as { updated_at?: string }).updated_at ?? new Date().toISOString(),
      });
    }

    if (data.repositories.length < perPage) break;
    page++;
  }

  return repos;
}

/**
 * Fetch the authenticated user's login + all org logins they belong to.
 * Returns [personalLogin, ...orgLogins].
 */
export async function listGithubOwners(userId: string): Promise<string[]> {
  const userToken = await getGitHubUserToken(userId);
  if (userToken) {
    const client = new Octokit({ auth: userToken });
    const [{ data: user }, { data: orgs }] = await Promise.all([
      client.request("GET /user"),
      client.request("GET /user/orgs", { per_page: 25 }),
    ]);
    return [user.login, ...orgs.map((o) => o.login)];
  }

  // Installation fallback: get account logins from all installations for this user
  if (!hasGitHubAppConfig()) return [];

  const installations = await prisma.githubInstallation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  if (installations.length === 0) return [];

  // Each installation's accountLogin is an owner (user or org)
  const owners: string[] = [];
  const seen = new Set<string>();
  for (const inst of installations) {
    if (inst.accountLogin && !seen.has(inst.accountLogin)) {
      seen.add(inst.accountLogin);
      owners.push(inst.accountLogin);
    }
  }

  // If no accountLogins stored, fall back to extracting from repos
  if (owners.length === 0) {
    const client = await getInstallationClient(userId);
    if (!client) return [];
    let page = 1;
    while (page <= 5) {
      const { data } = await client.request("GET /installation/repositories", { per_page: 100, page });
      for (const repo of data.repositories) {
        const owner = repo.full_name.split("/")[0];
        if (!seen.has(owner)) {
          seen.add(owner);
          owners.push(owner);
        }
      }
      if (data.repositories.length < 100) break;
      page++;
    }
  }

  return owners;
}

function pushRepo(repos: RepoListItem[], repo: { full_name: string; name: string; owner?: { login: string } | null; default_branch?: string; private: boolean; description?: string | null; updated_at?: string | null }) {
  repos.push({
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner?.login ?? repo.full_name.split("/")[0],
    defaultBranch: repo.default_branch ?? "main",
    isPrivate: repo.private,
    description: repo.description ?? null,
    updatedAt: repo.updated_at ?? new Date().toISOString(),
  });
}

/**
 * Fetch repos for a specific owner.
 * - Personal: ALL repos paginated (up to 500), sorted by updated.
 * - Org: 50 most recently updated repos (1 page).
 */
export async function listGithubReposByOwner(
  userId: string,
  owner: string,
): Promise<RepoListItem[]> {
  const repos: RepoListItem[] = [];
  const userToken = await getGitHubUserToken(userId);

  if (userToken) {
    const client = new Octokit({ auth: userToken });
    const { data: authedUser } = await client.request("GET /user");

    if (authedUser.login === owner) {
      // Personal repos — paginate ALL (up to 500)
      let page = 1;
      const perPage = 100;
      const maxPages = 5;
      while (page <= maxPages) {
        const { data } = await client.request("GET /user/repos", {
          per_page: perPage,
          page,
          sort: "updated",
          affiliation: "owner,collaborator,organization_member",
        });
        console.log(`[github] listGithubReposByOwner page=${page} returned=${data.length} total=${repos.length + data.length}`);
        for (const repo of data) pushRepo(repos, repo);
        if (data.length < perPage) break;
        page++;
      }
      console.log(`[github] listGithubReposByOwner DONE owner=${owner} total=${repos.length}`);
    } else {
      // Org repos — 50 most recently updated
      const { data } = await client.request("GET /orgs/{org}/repos", {
        org: owner,
        per_page: 50,
        sort: "updated",
        type: "all",
      });
      for (const repo of data) pushRepo(repos, repo);
    }
    return repos;
  }

  // Installation fallback (no user OAuth token) — paginate all
  const client = await getInstallationClient(userId);
  if (!client) return [];
  let page = 1;
  const perPage = 100;
  const maxPages = 5;
  while (page <= maxPages) {
    const { data } = await client.request("GET /installation/repositories", {
      per_page: perPage,
      page,
    });
    for (const repo of data.repositories) {
      if (repo.full_name.split("/")[0] === owner) {
        pushRepo(repos, repo as unknown as Parameters<typeof pushRepo>[1]);
      }
    }
    if (data.repositories.length < perPage) break;
    page++;
  }
  console.log(`[github] listGithubReposByOwner installation fallback owner=${owner} total=${repos.length}`);
  return repos;
}

const GITHUB_REPOS_CACHE_TTL = 86400; // 24 hours

/**
 * Cached owners list (user login + org logins). 24h TTL.
 */
export async function listGithubOwnersCached(
  userId: string,
  forceRefresh?: boolean,
): Promise<string[]> {
  const cacheKey = `github-owners:${userId}`;
  if (forceRefresh) {
    await invalidateCache(cacheKey);
  }
  return getCached(cacheKey, GITHUB_REPOS_CACHE_TTL, () => listGithubOwners(userId));
}

/**
 * Cached repos for a specific owner. 24h TTL.
 */
export async function listGithubReposByOwnerCached(
  userId: string,
  owner: string,
  forceRefresh?: boolean,
): Promise<RepoListItem[]> {
  const cacheKey = `github-repos:${userId}:${owner}`;
  if (forceRefresh) {
    await invalidateCache(cacheKey);
  }
  return getCached(cacheKey, GITHUB_REPOS_CACHE_TTL, () => listGithubReposByOwner(userId, owner));
}

/**
 * Clear all GitHub caches for a user (repos, owners, per-owner).
 */
export async function invalidateGithubRepoCache(userId: string): Promise<void> {
  await invalidateCache(`github-owners:${userId}`);
  // Per-owner caches use dynamic keys — clear owner keys we know about
  const owners = await listGithubOwnersCached(userId).catch(() => []);
  const ownerKeys = owners.map((o) => `github-repos:${userId}:${o}`);
  if (ownerKeys.length > 0) {
    await invalidateCache(...ownerKeys);
  }
}

/**
 * Pre-populate caches for a user: owners list + repos per owner.
 * Called fire-and-forget after GitHub App install.
 */
export async function warmGithubRepoCache(userId: string): Promise<void> {
  const owners = await listGithubOwnersCached(userId, true);
  // Cache all owners' repos in parallel
  await Promise.all(
    owners.map((owner) => listGithubReposByOwnerCached(userId, owner, true)),
  );
}

/**
 * Search repos via GitHub Search API.
 */
export async function searchGithubRepos(
  userId: string,
  query: string,
): Promise<RepoListItem[]> {
  const userToken = await getGitHubUserToken(userId);
  if (userToken) {
    const userClient = new Octokit({ auth: userToken });
    const { data } = await userClient.request("GET /search/repositories", {
      q: `${query} in:name fork:true`,
      per_page: 15,
      sort: "updated",
    });
    return data.items.map((repo) => ({
      fullName: repo.full_name,
      name: repo.name,
      owner: repo.owner?.login ?? repo.full_name.split("/")[0],
      defaultBranch: repo.default_branch ?? "main",
      isPrivate: repo.private,
      description: repo.description,
      updatedAt: repo.updated_at ?? new Date().toISOString(),
    }));
  }

  // Fallback: filter from cached repos for current owner
  return [];
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
  } catch {
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
