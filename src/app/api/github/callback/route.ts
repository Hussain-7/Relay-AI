import { NextRequest, NextResponse } from "next/server";
import {
  getInstallationDetails,
  parseGithubInstallState,
} from "@/lib/github-app";
import { prisma } from "@/lib/prisma";

function buildRedirectBase(request: NextRequest): string {
  return process.env.APP_URL ?? request.nextUrl.origin;
}

function normalizeInstallationAccount(
  account: unknown,
): Record<string, unknown> {
  if (!account || typeof account !== "object") {
    return {
      id: null,
      login: null,
      type: null,
    };
  }

  const record = account as Record<string, unknown>;

  return {
    id: typeof record.id === "number" ? record.id : null,
    login:
      typeof record.login === "string"
        ? record.login
        : typeof record.slug === "string"
          ? record.slug
          : typeof record.name === "string"
            ? record.name
            : null,
    type: typeof record.type === "string" ? record.type : null,
  };
}

export async function GET(request: NextRequest) {
  const redirectBase = buildRedirectBase(request);

  try {
    const installationId = request.nextUrl.searchParams.get("installation_id");
    const state = request.nextUrl.searchParams.get("state");

    if (!installationId || !state) {
      return NextResponse.redirect(
        `${redirectBase}/onboarding?github_error=missing_parameters`,
      );
    }

    const { userId } = parseGithubInstallState(state);
    const details = await getInstallationDetails(installationId);
    const normalizedAccount = normalizeInstallationAccount(details.account);

    await prisma.githubInstallation.upsert({
      where: {
        userId_installationId: {
          userId,
          installationId,
        },
      },
      update: {
        accountJson: {
          ...normalizedAccount,
          target_type: details.target_type,
          app_id: details.app_id,
        },
      },
      create: {
        userId,
        installationId,
        accountJson: {
          ...normalizedAccount,
          target_type: details.target_type,
          app_id: details.app_id,
        },
      },
    });

    return NextResponse.redirect(
      `${redirectBase}/onboarding?github=connected&installation_id=${encodeURIComponent(installationId)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.redirect(
      `${redirectBase}/onboarding?github_error=${encodeURIComponent(message)}`,
    );
  }
}
