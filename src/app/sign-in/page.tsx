import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrCreateOnboardingState } from "@/lib/onboarding";
import { getServerSessionUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await getServerSessionUser();
  if (user) {
    const onboarding = await getOrCreateOnboardingState(user.userId);
    if (onboarding.isCompleted) {
      redirect("/chat");
    }
    redirect("/onboarding");
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto w-full max-w-lg rounded-3xl border border-white/40 bg-white/85 p-8 text-center shadow-[0_20px_80px_rgba(12,24,40,0.14)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Endless Dev</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">
          Sign in to continue
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Use your Google account to access onboarding, chat workspace, and
          settings.
        </p>

        <Link
          href="/api/auth/google/start"
          className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Continue with Google
        </Link>

        <Link
          href="/"
          className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400"
        >
          Back to landing
        </Link>
      </div>
    </main>
  );
}
