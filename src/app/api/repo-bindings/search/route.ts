import { z } from "zod";

import { searchGithubRepos } from "@/lib/github/service";
import { requireRequestUser } from "@/lib/server-auth";

const searchSchema = z.object({
  query: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);
    const body = searchSchema.parse(await request.json());
    const repos = await searchGithubRepos(user.userId, body.query);
    return Response.json({ repos });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Search failed." }, { status: 400 });
  }
}
