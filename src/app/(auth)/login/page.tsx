"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

/* ── Inline SVG icons ── */

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" transform="rotate(45 12 12)" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/* ── Feature data ── */

const CAPABILITIES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "AI Chat with Citations",
    description: "Have rich conversations powered by Claude. Get answers backed by real-time web search with inline source citations you can verify.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
    title: "Deep Research",
    description: "Search the web, fetch and read full pages, and synthesize findings across multiple sources — all within a single conversation.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    title: "Remote Coding Sessions",
    description: "Spin up persistent cloud sandboxes with full Git access. The coding agent reads, writes, tests, commits, and creates pull requests for you.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M12 18v-6" />
        <path d="m9 15 3 3 3-3" />
      </svg>
    ),
    title: "Document Generation",
    description: "Create Excel spreadsheets, PowerPoint presentations, Word documents, and PDFs directly in chat. Download them instantly.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    title: "GitHub Integration",
    description: "Connect repositories directly. Clone, branch, commit, push, and open pull requests — all orchestrated by the AI agent inside cloud sandboxes.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M12 12v9" />
        <path d="m8 17 4 4 4-4" />
      </svg>
    ),
    title: "File Uploads & Analysis",
    description: "Upload images, PDFs, and documents. Claude reads, analyzes, and reasons over your files with full context in the conversation.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="m7 8 3 3-3 3" />
        <path d="M13 14h3" />
      </svg>
    ),
    title: "Code Execution",
    description: "Run Python, JavaScript, and shell scripts in a secure server-side sandbox. Perfect for data analysis, math, parsing, and quick prototyping.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
    title: "MCP Connectors",
    description: "Extend capabilities with Model Context Protocol servers. Connect external tools and data sources directly into your AI workspace.",
  },
];

const TECH_HIGHLIGHTS = [
  { label: "Claude Opus & Sonnet", detail: "Latest models with extended thinking" },
  { label: "E2B Sandboxes", detail: "Persistent cloud dev environments" },
  { label: "Real-time Streaming", detail: "Token-by-token response delivery" },
  { label: "Adaptive Thinking", detail: "Scales reasoning to task complexity" },
];

/* ── Page ── */

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/chat/new";
  const [isLoading, setIsLoading] = useState(false);

  async function handleGoogleSignIn() {
    setIsLoading(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return (
    <div className="bg-background text-foreground">

      {/* ─── Hero ─── */}
      <section className="relative flex h-dvh flex-col lg:flex-row">
        {/* Left — branding + sign-in */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 lg:py-0">
          <div className="w-full max-w-[420px]">
            <div className="mb-10 flex items-center gap-3">
              <SparkIcon className="h-8 w-8 text-accent" />
              <span className="text-[1.15rem] font-semibold tracking-[-0.02em]">Relay AI</span>
            </div>

            <h1 className="font-serif text-[2.6rem] leading-[1.08] tracking-[-0.03em] text-[rgba(245,240,232,0.95)] max-[480px]:text-[2rem]">
              Think fast,<br />build faster
            </h1>
            <p className="mt-4 text-[0.95rem] leading-[1.55] text-[rgba(245,240,232,0.5)] max-w-[360px]">
              An AI workspace that combines chat, deep research, file handling, document generation, and remote coding sessions — all powered by Claude.
            </p>

            <div className="mt-10">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-5 py-3 text-[0.9rem] font-medium text-[rgba(245,240,232,0.92)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.18)] active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <GoogleIcon />
                {isLoading ? "Redirecting..." : "Continue with Google"}
              </button>
            </div>

            <p className="mt-5 text-[0.78rem] text-[rgba(245,240,232,0.28)]">
              Access is currently invite-only.
            </p>
          </div>
        </div>

        {/* Right — decorative mock UI */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-12">
          <div className="relative w-full max-w-[520px] aspect-[4/3] rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(145deg,rgba(30,29,27,0.95),rgba(22,21,19,0.98))] shadow-[0_40px_120px_rgba(0,0,0,0.4)] overflow-hidden">
            <div className="absolute inset-0 flex flex-col p-6">
              <div className="flex gap-1 self-center rounded-full bg-[rgba(255,255,255,0.06)] p-1 mb-6">
                <span className="rounded-full bg-[rgba(255,255,255,0.1)] px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.8)]">Chat</span>
                <span className="rounded-full px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.35)]">Research</span>
                <span className="rounded-full px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.35)]">Code</span>
              </div>
              <div className="self-end max-w-[75%] rounded-[16px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.06)] px-4 py-2.5 mb-4">
                <p className="text-[0.82rem] text-[rgba(245,240,232,0.85)]">Refactor the auth module and open a PR</p>
              </div>
              <div className="flex items-center gap-2 mb-3 ml-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-2 animate-pulse" />
                <span className="text-[rgba(245,240,232,0.4)] text-[0.75rem]">Cloned repo</span>
                <span className="text-[rgba(245,240,232,0.15)]">&middot;</span>
                <span className="text-[rgba(245,240,232,0.4)] text-[0.75rem]">Reading 12 files</span>
                <span className="text-[rgba(245,240,232,0.15)]">&middot;</span>
                <span className="text-[rgba(245,240,232,0.4)] text-[0.75rem]">Writing changes</span>
              </div>
              <div className="max-w-[85%] mb-4">
                <p className="text-[0.82rem] leading-[1.55] text-[rgba(245,240,232,0.72)]">
                  I&apos;ve refactored the auth middleware into a clean session-based pattern, added tests, and opened PR #42 with the changes.
                </p>
              </div>
              {/* File chips */}
              <div className="flex gap-2 mb-4">
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[0.72rem] text-[rgba(245,240,232,0.55)]">auth.ts</span>
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[0.72rem] text-[rgba(245,240,232,0.55)]">session.ts</span>
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[0.72rem] text-[rgba(245,240,232,0.55)]">+3 files</span>
              </div>
              <div className="mt-auto flex items-center gap-2 ml-1">
                <span className="pending-spark-pulse inline-grid place-items-center text-accent">
                  <SparkIcon className="h-4 w-4" />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll hint */}
        <button
          type="button"
          onClick={() => document.getElementById("capabilities")?.scrollIntoView({ behavior: "smooth" })}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden lg:flex flex-col items-center gap-1.5 text-[rgba(245,240,232,0.25)] hover:text-[rgba(245,240,232,0.5)] transition-colors duration-200 cursor-pointer bg-transparent border-0"
        >
          <span className="text-[0.72rem] tracking-[0.08em] uppercase">Explore</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="animate-bounce">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </section>

      {/* ─── Capabilities Grid ─── */}
      <section id="capabilities" className="relative px-6 py-28 max-[480px]:py-20">
        <div className="mx-auto max-w-[1080px]">
          <div className="text-center mb-16">
            <h2 className="font-serif text-[2.2rem] leading-[1.1] tracking-[-0.02em] text-[rgba(245,240,232,0.92)] max-[480px]:text-[1.7rem]">
              Everything you need in one workspace
            </h2>
            <p className="mt-4 mx-auto max-w-[520px] text-[0.92rem] leading-[1.55] text-[rgba(245,240,232,0.45)]">
              Relay AI brings together conversational AI, research tools, code execution, and full development workflows — so you never have to context-switch.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {CAPABILITIES.map((cap) => (
              <div
                key={cap.title}
                className="group rounded-[16px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5 transition-all duration-200 hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.04)]"
              >
                <div className="mb-3.5 inline-flex h-10 w-10 items-center justify-center rounded-[10px] bg-[rgba(255,255,255,0.06)] text-[rgba(245,240,232,0.6)] transition-colors duration-200 group-hover:text-accent group-hover:bg-[rgba(221,113,72,0.1)]">
                  {cap.icon}
                </div>
                <h3 className="text-[0.88rem] font-medium text-[rgba(245,240,232,0.88)] mb-1.5">{cap.title}</h3>
                <p className="text-[0.8rem] leading-[1.5] text-[rgba(245,240,232,0.42)]">{cap.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section className="px-6 py-28 max-[480px]:py-20 border-t border-[rgba(255,255,255,0.05)]">
        <div className="mx-auto max-w-[860px]">
          <div className="text-center mb-16">
            <h2 className="font-serif text-[2.2rem] leading-[1.1] tracking-[-0.02em] text-[rgba(245,240,232,0.92)] max-[480px]:text-[1.7rem]">
              Two agents, one workflow
            </h2>
            <p className="mt-4 mx-auto max-w-[480px] text-[0.92rem] leading-[1.55] text-[rgba(245,240,232,0.45)]">
              A main conversational agent handles research and orchestration. When you need code, it delegates to a specialized coding agent inside a cloud sandbox.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Main agent */}
            <div className="rounded-[18px] border border-[rgba(255,255,255,0.07)] bg-[linear-gradient(160deg,rgba(30,29,27,0.6),rgba(22,21,19,0.8))] p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="h-9 w-9 rounded-full bg-[rgba(221,113,72,0.15)] inline-grid place-items-center">
                  <SparkIcon className="h-4.5 w-4.5 text-accent" />
                </div>
                <div>
                  <h3 className="text-[0.92rem] font-medium text-[rgba(245,240,232,0.88)]">Main Agent</h3>
                  <p className="text-[0.75rem] text-[rgba(245,240,232,0.38)]">Conversational & research</p>
                </div>
              </div>
              <ul className="space-y-2.5">
                {["Web search & fetch with citations", "File uploads & document analysis", "Code execution for quick analysis", "Document generation (xlsx, pptx, docx, pdf)", "MCP tool integrations", "Orchestrates coding sessions"].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[0.82rem] text-[rgba(245,240,232,0.55)]">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Coding agent */}
            <div className="rounded-[18px] border border-[rgba(255,255,255,0.07)] bg-[linear-gradient(160deg,rgba(30,29,27,0.6),rgba(22,21,19,0.8))] p-7">
              <div className="flex items-center gap-3 mb-5">
                <div className="h-9 w-9 rounded-full bg-[rgba(122,168,148,0.15)] inline-grid place-items-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4.5 w-4.5 text-accent-2">
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[0.92rem] font-medium text-[rgba(245,240,232,0.88)]">Coding Agent</h3>
                  <p className="text-[0.75rem] text-[rgba(245,240,232,0.38)]">Cloud sandbox development</p>
                </div>
              </div>
              <ul className="space-y-2.5">
                {["Full filesystem read/write/edit", "Git clone, commit, push workflows", "Run tests & shell commands", "Create branches & pull requests", "Persistent sandbox state across turns", "Powered by Claude Code in E2B"].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[0.82rem] text-[rgba(245,240,232,0.55)]">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-2 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Tech highlights ─── */}
      <section className="px-6 py-20 max-[480px]:py-16 border-t border-[rgba(255,255,255,0.05)]">
        <div className="mx-auto max-w-[860px]">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {TECH_HIGHLIGHTS.map((item) => (
              <div key={item.label} className="text-center py-4">
                <div className="text-[0.95rem] font-medium text-[rgba(245,240,232,0.82)]">{item.label}</div>
                <div className="mt-1 text-[0.78rem] text-[rgba(245,240,232,0.38)]">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA ─── */}
      <section className="px-6 py-28 max-[480px]:py-20 border-t border-[rgba(255,255,255,0.05)]">
        <div className="mx-auto max-w-[480px] text-center">
          <SparkIcon className="h-10 w-10 text-accent mx-auto mb-6" />
          <h2 className="font-serif text-[2rem] leading-[1.12] tracking-[-0.02em] text-[rgba(245,240,232,0.92)] max-[480px]:text-[1.6rem]">
            Ready to get started?
          </h2>
          <p className="mt-3 text-[0.9rem] text-[rgba(245,240,232,0.45)]">
            Sign in to access your AI workspace.
          </p>
          <div className="mt-8 max-w-[320px] mx-auto">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-5 py-3 text-[0.9rem] font-medium text-[rgba(245,240,232,0.92)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.18)] active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <GoogleIcon />
              {isLoading ? "Redirecting..." : "Continue with Google"}
            </button>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="px-6 py-8 border-t border-[rgba(255,255,255,0.05)]">
        <div className="mx-auto max-w-[1080px] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[rgba(245,240,232,0.3)]">
            <SparkIcon className="h-4 w-4" />
            <span className="text-[0.78rem]">Relay AI</span>
          </div>
          <span className="text-[0.72rem] text-[rgba(245,240,232,0.22)]">Powered by Claude</span>
        </div>
      </footer>
    </div>
  );
}
