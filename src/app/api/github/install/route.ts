import crypto from "crypto";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!hasGitHubAppConfig()) {
    return Response.json({ error: "GitHub App is not configured." }, { status: 503 });
  }

  const user = await requireRequestUser(request.headers);

  // Generate a state token to prevent CSRF — encodes userId for the callback
  const statePayload = JSON.stringify({ userId: user.userId, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", env.GITHUB_STATE_SECRET ?? "fallback-secret");
  hmac.update(statePayload);
  const signature = hmac.digest("hex");
  const state = Buffer.from(`${statePayload}.${signature}`).toString("base64url");

  const installUrl = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${state}`;

  return Response.redirect(installUrl, 302);
}
