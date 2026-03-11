import { z } from "zod";

import { testMcpConnection } from "@/lib/mcp-connectors";
import { requireRequestUser } from "@/lib/server-auth";

const testSchema = z.object({
  url: z.string().url(),
  authorizationToken: z.string().optional(),
});

export async function POST(request: Request) {
  await requireRequestUser(request.headers);
  const body = testSchema.parse(await request.json());

  const result = await testMcpConnection(body.url, body.authorizationToken);

  return Response.json(result);
}
