import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

import { env, hasGitHubAppConfig } from "@/lib/env";
import { invalidateGithubRepoCache } from "@/lib/github/service";
import { prisma } from "@/lib/prisma";
import { requireRequestUser } from "@/lib/server-auth";

// Octokit + createAppAuth are used by the DELETE handler for uninstalling

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);

    if (!hasGitHubAppConfig()) {
      return Response.json({ configured: false, installed: false });
    }

    // Check if this user has a linked GitHub installation (created during the install callback)
    const existing = await prisma.githubInstallation.findFirst({
      where: { userId: user.userId },
    });

    if (existing) {
      return Response.json({
        configured: true,
        installed: true,
        account: existing.accountLogin ?? null,
        installUrl: `/api/github/install`,
      });
    }

    return Response.json({
      configured: true,
      installed: false,
      installUrl: `/api/github/install`,
    });
  } catch {
    return Response.json({ configured: false, installed: false });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);

    // Find all installations for this user
    const installations = await prisma.githubInstallation.findMany({
      where: { userId: user.userId },
    });

    // Try to uninstall from GitHub
    if (hasGitHubAppConfig()) {
      const appClient = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: env.GITHUB_APP_ID!,
          privateKey: env.GITHUB_APP_PRIVATE_KEY!,
        },
      });

      for (const inst of installations) {
        try {
          await appClient.request("DELETE /app/installations/{installation_id}", {
            installation_id: Number(inst.installationId),
          });
        } catch {
          // Installation may already be removed on GitHub side — continue
        }
      }
    }

    // Remove all installation records from DB
    await prisma.githubInstallation.deleteMany({
      where: { userId: user.userId },
    });

    // Clear cached repo list
    await invalidateGithubRepoCache(user.userId);

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Failed to disconnect GitHub" }, { status: 500 });
  }
}
