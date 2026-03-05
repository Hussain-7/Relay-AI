import { AppConsole } from "@/components/app-console";

export default function DevConsolePage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-8">
        <p className="text-sm text-slate-500">Console unavailable in production.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border border-black/10 bg-panel p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Dev</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            Agent Harness Console
          </h1>
        </header>
        <AppConsole />
      </div>
    </main>
  );
}
