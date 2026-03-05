import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { requireAppUser } from "@/lib/app-state";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { user, onboarding } = await requireAppUser();

  if (onboarding.isCompleted) {
    redirect("/chat");
  }

  return (
    <OnboardingWizard
      user={{ email: user.email, fullName: user.fullName }}
      onboarding={{
        currentStep: onboarding.currentStep,
        isCompleted: onboarding.isCompleted,
        stepDataJson:
          onboarding.stepDataJson && typeof onboarding.stepDataJson === "object"
            ? (onboarding.stepDataJson as Record<string, unknown>)
            : {},
      }}
    />
  );
}
