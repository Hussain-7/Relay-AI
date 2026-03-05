import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
import { getOrCreateOnboardingState } from "@/lib/onboarding";
import { getServerSessionUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getServerSessionUser();
  if (!user) {
    return <LandingPage />;
  }

  const onboarding = await getOrCreateOnboardingState(user.userId);
  if (!onboarding.isCompleted) {
    redirect("/onboarding");
  }

  redirect("/chat");
}
