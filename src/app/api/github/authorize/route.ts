import crypto from "crypto";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { requireRequestUser } from "@/lib/server-auth";

/**
 * Initiates GitHub OAuth flow to get a user access token.
 * This is separate from the app installation flow — it's used when the app is
 * already installed but no user OAuth token is stored.
 * Redirects to GitHub's authorization URL; GitHub redirects back to /api/github/callback.
 */
export async function GET(request: Request) {
  if (!hasGitHubAppConfig() || !env.GITHUB_APP_CLIENT_ID) {
    return Response.json({ error: "GitHub App is not configured." }, { status: 503 });
  }

  const user = await requireRequestUser(request.headers);

  // Build state token (same format as the install route)
  const statePayload = JSON.stringify({ userId: user.userId, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", env.GITHUB_STATE_SECRET ?? "fallback-secret");
  hmac.update(statePayload);
  const signature = hmac.digest("hex");
  const state = Buffer.from(`${statePayload}.${signature}`).toString("base64url");

  const callbackUrl = `${env.APP_URL}/api/github/callback`;
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_APP_CLIENT_ID}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;

  return Response.redirect(authUrl, 302);
}
