import { NextRequest, NextResponse } from "next/server";
import { resolveAuthContext } from "@/lib/auth-context";
import { errorResponse } from "@/lib/http";
import { getOrCreateOnboardingState } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthContext(request);

    const [profile, onboarding] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId: auth.userId },
      }),
      getOrCreateOnboardingState(auth.userId),
    ]);

    return NextResponse.json({
      user: {
        userId: auth.userId,
        email: profile?.email ?? auth.email ?? null,
        fullName: profile?.fullName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      onboarding,
    });
  } catch (error) {
    return errorResponse(error, 401);
  }
}
