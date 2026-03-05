import Link from "next/link";

export function LandingPage() {
  return (
    <main className="landing-root min-h-screen px-6 py-10 md:px-10 md:py-14">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="rounded-3xl border border-white/30 bg-white/70 p-8 shadow-[0_24px_80px_rgba(19,28,44,0.12)] backdrop-blur md:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Endless Dev
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight text-slate-900 md:text-6xl">
            Research, code, and ship from one agent workspace.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-slate-600 md:text-lg">
            Bring your own OpenAI and Anthropic keys, attach MCP and internal
            tools, run coding tasks in prebuilt E2B containers, and open draft
            PRs without leaving chat.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Continue with Google
            </Link>
            <a
              href="#capabilities"
              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
            >
              See capabilities
            </a>
          </div>
        </header>

        <section
          id="capabilities"
          className="grid gap-4 md:grid-cols-3"
          aria-label="Core capabilities"
        >
          <article className="rounded-2xl border border-white/30 bg-white/60 p-6 backdrop-blur">
            <h2 className="text-base font-semibold text-slate-900">
              Chat + Agent Modes
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Fast conversation UX with tool timelines, approvals, and run
              visibility.
            </p>
          </article>
          <article className="rounded-2xl border border-white/30 bg-white/60 p-6 backdrop-blur">
            <h2 className="text-base font-semibold text-slate-900">
              Remote Coding
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              E2B sandbox sessions for clone, edit, test, commit, push, and
              draft PR generation.
            </p>
          </article>
          <article className="rounded-2xl border border-white/30 bg-white/60 p-6 backdrop-blur">
            <h2 className="text-base font-semibold text-slate-900">
              Extensible Tools
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Manage MCP servers, connectors, and custom tool schemas from one
              settings workspace.
            </p>
          </article>
        </section>
      </div>
    </main>
  );
}
