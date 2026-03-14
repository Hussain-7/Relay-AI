import { listKnownRepos, listGithubRepos } from "@/lib/github/service";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const [bindings, available] = await Promise.all([
      listKnownRepos(user.userId),
      listGithubRepos(user.userId).catch(() => []),
    ]);
    return Response.json({ bindings, available });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list repo bindings." },
      { status: 400 },
    );
  }
}
