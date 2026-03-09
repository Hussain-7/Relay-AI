import crypto from "crypto";

import { env, hasGitHubAppConfig } from "@/lib/env";
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

    // Redirect back to the app with success
    return Response.redirect(`${env.APP_URL}/chat/new?github_connected=true`, 302);
  } catch {
    return Response.redirect(`${env.APP_URL}/chat/new?github_error=save_failed`, 302);
  }
}
