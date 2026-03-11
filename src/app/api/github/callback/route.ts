import crypto from "crypto";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { encryptToken } from "@/lib/mcp-token-crypto";
import { prisma } from "@/lib/prisma";

function verifyState(stateParam: string): { userId: string } | null {
  try {
    const decoded = Buffer.from(stateParam, "base64url").toString();
    const dotIndex = decoded.lastIndexOf(".");
    if (dotIndex === -1) return null;

    const payload = decoded.slice(0, dotIndex);
    const signature = decoded.slice(dotIndex + 1);

    const hmac = crypto.createHmac("sha256", env.GITHUB_STATE_SECRET ?? "fallback-secret");
    hmac.update(payload);
    const expected = hmac.digest("hex");

    if (signature !== expected) return null;

    const parsed = JSON.parse(payload) as { userId: string; ts: number };

    // Reject tokens older than 10 minutes
    if (Date.now() - parsed.ts > 10 * 60 * 1000) return null;

    return { userId: parsed.userId };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!hasGitHubAppConfig()) {
    return Response.redirect(`${env.APP_URL}/chat/new?github_error=not_configured`, 302);
  }

  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const state = url.searchParams.get("state");

  if (!installationId || !state) {
    return Response.redirect(`${env.APP_URL}/chat/new?github_error=missing_params`, 302);
  }

  const verified = verifyState(state);
  if (!verified) {
    return Response.redirect(`${env.APP_URL}/chat/new?github_error=invalid_state`, 302);
  }

  try {
    // Store the installation for this user
    await prisma.githubInstallation.upsert({
      where: {
        userId_installationId: {
          userId: verified.userId,
          installationId,
        },
      },
      update: {
        updatedAt: new Date(),
      },
      create: {
        userId: verified.userId,
        installationId,
      },
    });

    // Exchange OAuth code for user access token (if available)
    // GitHub sends `code` when "Request user authorization during installation" is enabled
    const code = url.searchParams.get("code");

    if (code && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET) {
      try {
        const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            client_id: env.GITHUB_APP_CLIENT_ID,
            client_secret: env.GITHUB_APP_CLIENT_SECRET,
            code,
          }),
        });

        const tokenData = (await tokenResponse.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };

        if (tokenData.access_token) {
          const { encrypted: encToken, iv: tokenIv } = encryptToken(tokenData.access_token);

          const updateData: Record<string, unknown> = {
            encryptedUserToken: encToken,
            userTokenIv: tokenIv,
            userTokenExpiresAt: tokenData.expires_in
              ? new Date(Date.now() + tokenData.expires_in * 1000)
              : null,
          };

          if (tokenData.refresh_token) {
            const { encrypted: encRefresh, iv: refreshIv } = encryptToken(tokenData.refresh_token);
            updateData.encryptedRefreshToken = encRefresh;
            updateData.refreshTokenIv = refreshIv;
          }

          await prisma.githubInstallation.update({
            where: {
              userId_installationId: {
                userId: verified.userId,
                installationId,
              },
            },
            data: updateData,
          });
        }
      } catch {
        // User token exchange failed — installation still saved, just no user token
      }
    }

    // Redirect back to the app with success
    return Response.redirect(`${env.APP_URL}/chat/new?github_connected=true`, 302);
  } catch {
    return Response.redirect(`${env.APP_URL}/chat/new?github_error=save_failed`, 302);
  }
}
