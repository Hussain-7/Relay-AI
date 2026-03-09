import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);

    if (!hasGitHubAppConfig()) {
      return Response.json({ configured: false, installed: false });
    }

    // Always verify against GitHub API — handles both installs and uninstalls
    try {
      const appClient = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: env.GITHUB_APP_ID!,
          privateKey: env.GITHUB_APP_PRIVATE_KEY!,
        },
      });

      const { data: installations } = await appClient.request("GET /app/installations");

      if (installations.length > 0) {
        // Sync the installation to our DB
        const installationId = String(installations[0]!.id);
        await prisma.githubInstallation.upsert({
          where: {
            userId_installationId: {
              userId: user.userId,
              installationId,
            },
          },
          update: { updatedAt: new Date() },
          create: {
            userId: user.userId,
            installationId,
            accountLogin: installations[0]!.account?.login ?? null,
          },
        });

        return Response.json({
          configured: true,
          installed: true,
          account: installations[0]!.account?.login ?? null,
          installUrl: `/api/github/install`,
        });
      }

      // No installations found on GitHub — clean up DB if stale
      await prisma.githubInstallation.deleteMany({
        where: { userId: user.userId },
      });

      return Response.json({
        configured: true,
        installed: false,
        installUrl: `/api/github/install`,
      });
    } catch {
      // GitHub API failed — fall back to DB
      const existing = await prisma.githubInstallation.findFirst({
        where: { userId: user.userId },
      });

      return Response.json({
        configured: true,
        installed: Boolean(existing),
        installUrl: `/api/github/install`,
      });
    }
  } catch {
    return Response.json({ configured: false, installed: false });
  }
}
