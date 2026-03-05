import { redirect } from "next/navigation";
import { getOrCreateOnboardingState } from "@/lib/onboarding";
import { requireServerSessionUser } from "@/lib/server-auth";

export async function requireAppUser() {
  const user = await requireServerSessionUser();
  const onboarding = await getOrCreateOnboardingState(user.userId);

  return {
    user,
    onboarding,
  };
}

export async function requireOnboardedAppUser() {
  const state = await requireAppUser();
  if (!state.onboarding.isCompleted) {
    redirect("/onboarding");
  }
  return state;
}
