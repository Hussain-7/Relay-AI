import { prisma } from "@/lib/prisma";

export const ONBOARDING_REQUIRED_STEP = "providers";

export async function getOrCreateOnboardingState(userId: string) {
  return prisma.onboardingState.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      currentStep: ONBOARDING_REQUIRED_STEP,
      isCompleted: false,
      stepDataJson: {},
    },
  });
}

export async function hasAnyProviderCredential(userId: string): Promise<boolean> {
  const count = await prisma.providerCredential.count({
    where: {
      userId,
      status: "active",
    },
  });

  return count > 0;
}
