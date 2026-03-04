import { AppConsole } from "@/components/app-console";

export default function Home() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-2xl border border-black/10 bg-panel p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">
            Endless Dev
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
            General Agent Harness Console
          </h1>
          <p className="mt-3 max-w-4xl text-sm text-muted md:text-base">
            Next.js + Prisma + Supabase Auth + AI SDK harness with BYOK provider
            routing, MCP recommendation and approvals, E2B coding sessions,
            GitHub App integration, and connector/custom tool management.
          </p>
        </header>

        <AppConsole />
      </div>
    </main>
  );
}
