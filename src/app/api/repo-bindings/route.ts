import { listKnownRepos } from "@/lib/github/service";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const bindings = await listKnownRepos(user.userId);
    return Response.json({ bindings });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list repo bindings." },
      { status: 400 },
    );
  }
}
