import {
  listGithubOwnersCached,
  listGithubReposByOwnerCached,
  listKnownRepos,
  warmGithubRepoCache,
} from "@/lib/github/service";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "true";
    const ownerParam = url.searchParams.get("owner");

    // Full refresh: invalidate all caches and re-warm everything
    if (forceRefresh && !ownerParam) {
      await warmGithubRepoCache(user.userId);
    }

    // If an owner is specified, fetch that owner's repos specifically
    if (ownerParam) {
      const repos = await listGithubReposByOwnerCached(user.userId, ownerParam).catch((err) => {
        console.warn("[repo-bindings] Failed to list repos for owner:", ownerParam, err.message);
        return [];
      });
      return Response.json({ repos });
    }

    const [bindings, owners] = await Promise.all([
      listKnownRepos(user.userId),
      listGithubOwnersCached(user.userId).catch((err) => {
        console.warn("[repo-bindings] Failed to list GitHub owners:", err.message);
        return [];
      }),
    ]);
    return Response.json({ bindings, available: [], owners });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list repo bindings." },
      { status: 400 },
    );
  }
}
