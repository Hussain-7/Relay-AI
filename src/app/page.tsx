"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";

/* ── Icons ── */

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
      <path
        d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z"
        fill="currentColor"
        transform="rotate(45 12 12)"
      />
    </svg>
  );
}

/* ── Custom cursor hook (landing page only) ── */

function useCustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: -100, y: -100 });
  const visible = useRef(false);

  const onMove = useCallback((e: MouseEvent) => {
    pos.current = { x: e.clientX, y: e.clientY };
    if (!visible.current) {
      visible.current = true;
      if (dotRef.current) dotRef.current.style.opacity = "1";
      if (ringRef.current) ringRef.current.style.opacity = "1";
    }
    if (dotRef.current) {
      dotRef.current.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 4}px)`;
    }
  }, []);

  const onHoverIn = useCallback(() => {
    if (ringRef.current) {
      ringRef.current.style.width = "48px";
      ringRef.current.style.height = "48px";
      ringRef.current.style.borderColor = "rgba(221,113,72,0.5)";
    }
    if (dotRef.current) {
      dotRef.current.style.transform = `translate(${pos.current.x - 4}px, ${pos.current.y - 4}px) scale(1.5)`;
      dotRef.current.style.background = "#dd7148";
    }
  }, []);

  const onHoverOut = useCallback(() => {
    if (ringRef.current) {
      ringRef.current.style.width = "32px";
      ringRef.current.style.height = "32px";
      ringRef.current.style.borderColor = "rgba(245,240,232,0.18)";
    }
    if (dotRef.current) {
      dotRef.current.style.transform = `translate(${pos.current.x - 4}px, ${pos.current.y - 4}px) scale(1)`;
      dotRef.current.style.background = "rgba(245,240,232,0.85)";
    }
  }, []);

  const onLeave = useCallback(() => {
    visible.current = false;
    if (dotRef.current) dotRef.current.style.opacity = "0";
    if (ringRef.current) ringRef.current.style.opacity = "0";
  }, []);

  useEffect(() => {
    // Only enable on non-touch devices
    if (window.matchMedia("(pointer: coarse)").matches) return;

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);

    // Trailing ring animation loop
    let raf: number;
    const ringPos = { x: -100, y: -100 };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const tick = () => {
      ringPos.x = lerp(ringPos.x, pos.current.x, 0.15);
      ringPos.y = lerp(ringPos.y, pos.current.y, 0.15);
      if (ringRef.current) {
        ringRef.current.style.transform = `translate(${ringPos.x - 16}px, ${ringPos.y - 16}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Add hover listeners to interactive elements
    const interactives = document.querySelectorAll("a, button, [role='button']");
    for (const el of interactives) {
      el.addEventListener("mouseenter", onHoverIn);
      el.addEventListener("mouseleave", onHoverOut);
    }

    // Hide default cursor on the landing page
    document.body.style.cursor = "none";
    for (const el of interactives) {
      (el as HTMLElement).style.cursor = "none";
    }

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
      document.body.style.cursor = "";
      for (const el of interactives) {
        el.removeEventListener("mouseenter", onHoverIn);
        el.removeEventListener("mouseleave", onHoverOut);
        (el as HTMLElement).style.cursor = "";
      }
    };
  }, [onMove, onLeave, onHoverIn, onHoverOut]);

  return { dotRef, ringRef };
}

/* ── Scroll-triggered reveal hook ── */

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).style.opacity = "1";
            (entry.target as HTMLElement).style.transform = "translateY(0)";
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    const targets = el.querySelectorAll("[data-reveal]");
    for (const t of targets) {
      (t as HTMLElement).style.opacity = "0";
      (t as HTMLElement).style.transform = "translateY(28px)";
      (t as HTMLElement).style.transition =
        "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)";
      observer.observe(t);
    }
    return () => observer.disconnect();
  }, []);
  return ref;
}

/* ── Data ── */

const CAPABILITIES = [
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "AI Chat with Citations",
    desc: "Conversations backed by real-time web search with verifiable inline source citations.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
    title: "Deep Research",
    desc: "Search, fetch full pages, and synthesize findings across multiple sources in one conversation.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    title: "Remote Coding Sessions",
    desc: "Persistent cloud sandboxes that survive across turns with full read/write/test/commit/PR workflows.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M12 18v-6" />
        <path d="m9 15 3 3 3-3" />
      </svg>
    ),
    title: "Document Generation",
    desc: "Create Excel, PowerPoint, Word documents, and PDFs directly in chat. Download instantly.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
    ),
    title: "GitHub Integration",
    desc: "Connect or create repos. Clone, branch, commit, push, and open PRs with encrypted secrets.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
        <path d="M12 12v9" />
        <path d="m8 17 4 4 4-4" />
      </svg>
    ),
    title: "File Uploads & Analysis",
    desc: "Upload images, PDFs, and documents. Claude reads and reasons over your files in context.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="m7 8 3 3-3 3" />
        <path d="M13 14h3" />
      </svg>
    ),
    title: "Code Execution",
    desc: "Run Python, JavaScript, and shell scripts in a secure sandbox for analysis and prototyping.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
    title: "Image Generation & Editing",
    desc: "Generate and edit images with Imagen 4 and Gemini. Iterate with follow-up edits in conversation.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    title: "Instant Preview URLs",
    desc: "Shareable public URLs for HTML artifacts and sandbox dev servers. Preview work in your browser.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    ),
    title: "Persistent Memory",
    desc: "Workspace-level memory that persists across conversations. The agent stays aligned with your work.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    ),
    title: "Interactive Decisions",
    desc: "The agent pauses to ask clarifying questions. Choose from options or type a freeform response.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
    title: "MCP Connectors",
    desc: "Extend capabilities with Model Context Protocol servers and OAuth-secured external tools.",
  },
];

const MAIN_AGENT_FEATURES = [
  "Web search & fetch with citations",
  "File uploads & document analysis",
  "Image generation & editing (Imagen 4, Gemini)",
  "Code execution for quick analysis",
  "Document generation (xlsx, pptx, docx, pdf)",
  "MCP tool integrations",
  "Orchestrates coding sessions",
];

const CODING_AGENT_FEATURES = [
  "Full filesystem read/write/edit",
  "Git clone, commit, push workflows",
  "Run tests & shell commands",
  "Create branches & pull requests",
  "Persistent sandbox state across turns",
  "Powered by Claude Code in E2B",
];

const TECH = [
  { label: "Claude Opus & Sonnet", detail: "Latest models with extended thinking" },
  { label: "E2B Sandboxes", detail: "Persistent cloud dev environments" },
  { label: "Real-time Streaming", detail: "Token-by-token response delivery" },
  { label: "Adaptive Thinking", detail: "Scales reasoning to task complexity" },
];

/* ── Page ── */

export default function LandingPage() {
  const revealRef = useScrollReveal();
  const { dotRef, ringRef } = useCustomCursor();

  useEffect(() => {
    document.documentElement.classList.add("allow-scroll");
    return () => document.documentElement.classList.remove("allow-scroll");
  }, []);

  return (
    <div ref={revealRef} className="bg-background text-foreground overflow-x-hidden">
      {/* Noise grain overlay for texture depth */}
      <div
        className="pointer-events-none fixed inset-0 z-[100] opacity-[0.03] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "256px 256px",
        }}
      />

      {/* Custom cursor elements */}
      <div
        ref={dotRef}
        className="pointer-events-none fixed top-0 left-0 z-[9999] w-2 h-2 rounded-full mix-blend-difference"
        style={{
          background: "rgba(245,240,232,0.85)",
          opacity: 0,
          transition: "opacity 0.3s, transform 0.08s, background 0.25s",
          willChange: "transform",
        }}
      />
      <div
        ref={ringRef}
        className="pointer-events-none fixed top-0 left-0 z-[9998] w-8 h-8 rounded-full border"
        style={{
          borderColor: "rgba(245,240,232,0.18)",
          opacity: 0,
          transition:
            "opacity 0.3s, width 0.3s cubic-bezier(0.16,1,0.3,1), height 0.3s cubic-bezier(0.16,1,0.3,1), border-color 0.25s",
          willChange: "transform",
        }}
      />
      {/* ── Floating nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-10 py-4 bg-[rgba(38,38,36,0.8)] backdrop-blur-xl border-b border-[rgba(255,255,255,0.04)]">
        <div className="flex items-center gap-2.5">
          <SparkIcon className="h-6 w-6 text-accent" />
          <span className="text-[0.95rem] font-semibold tracking-[-0.02em]">Relay AI</span>
        </div>
        <Link
          href="/login"
          className="rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.1)] px-5 py-2 text-[0.82rem] font-medium text-[rgba(245,240,232,0.88)] no-underline transition-all duration-150 hover:bg-[rgba(255,255,255,0.14)] hover:border-[rgba(255,255,255,0.18)]"
        >
          Sign in
        </Link>
      </nav>

      {/* ═══════════════════════════════════════════
          HERO — Refined, subtle layout
          ═══════════════════════════════════════════ */}
      <section className="relative min-h-dvh flex flex-col items-center px-6 pt-32 pb-20 overflow-hidden">
        {/* Atmospheric radial glows — very subtle */}
        <div
          className="pointer-events-none absolute top-[5%] left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full opacity-[0.045]"
          style={{ background: "radial-gradient(circle, #dd7148 0%, transparent 65%)" }}
        />
        <div
          className="pointer-events-none absolute bottom-[10%] right-[-5%] w-[500px] h-[500px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #7aa894 0%, transparent 65%)" }}
        />

        {/* Overline pill */}
        <div
          className="mb-8 flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] px-4 py-1.5"
          style={{ animation: "landing-fade-in 0.8s ease-out both" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent-2 animate-pulse" />
          <span className="text-[0.74rem] text-[rgba(245,240,232,0.45)] tracking-wide">
            Powered by Claude Opus & Sonnet
          </span>
        </div>

        {/* Headline — refined sizing */}
        <h1
          className="font-serif text-center text-[clamp(2rem,4.5vw,3.2rem)] leading-[1.15] tracking-[-0.025em] text-[rgba(245,240,232,0.92)] max-w-[600px]"
          style={{ animation: "landing-fade-in 0.9s ease-out 0.1s both" }}
        >
          Your AI workspace for <span className="text-accent">thinking</span> &{" "}
          <span className="text-accent-2">building</span>
        </h1>

        {/* Subline */}
        <p
          className="mt-4 text-center text-[0.95rem] leading-[1.65] text-[rgba(245,240,232,0.42)] max-w-[460px]"
          style={{ animation: "landing-fade-in 0.9s ease-out 0.2s both" }}
        >
          Chat, research, generate images, create documents, and run coding sessions in cloud sandboxes — orchestrated
          by a two-tier AI agent.
        </p>

        {/* CTA — smaller, more refined */}
        <div className="mt-8 flex items-center gap-3" style={{ animation: "landing-fade-in 0.9s ease-out 0.35s both" }}>
          <Link
            href="/login"
            className="group relative rounded-lg bg-accent px-6 py-2.5 text-[0.84rem] font-semibold text-background no-underline transition-all duration-200 hover:brightness-110 hover:shadow-[0_6px_24px_rgba(221,113,72,0.25)] active:scale-[0.98]"
          >
            Get Started
            <span className="ml-1.5 inline-block transition-transform duration-200 group-hover:translate-x-0.5">
              &rarr;
            </span>
          </Link>
          <a
            href="#capabilities"
            className="rounded-lg border border-[rgba(255,255,255,0.08)] px-5 py-2.5 text-[0.84rem] font-medium text-[rgba(245,240,232,0.6)] no-underline transition-all duration-200 hover:border-[rgba(255,255,255,0.16)] hover:text-[rgba(245,240,232,0.88)]"
          >
            Explore features
          </a>
        </div>

        {/* Product vignette — the visual centrepiece */}
        <div
          className="relative mt-14 w-full max-w-[720px]"
          style={{ animation: "landing-float-in 1.1s cubic-bezier(0.16,1,0.3,1) 0.4s both" }}
        >
          <div className="rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(170deg,rgba(42,41,38,0.95),rgba(30,29,27,0.98))] shadow-[0_48px_100px_-20px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)] overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[rgba(255,255,255,0.06)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.1)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.1)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[rgba(255,255,255,0.1)]" />
              <span className="ml-auto text-[0.72rem] text-[rgba(245,240,232,0.3)]">relay-ai.app</span>
            </div>
            {/* Content */}
            <div className="p-6 lg:p-8">
              {/* User prompt */}
              <div className="flex justify-end mb-5">
                <div className="rounded-[14px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.06)] px-4 py-2.5 max-w-[70%]">
                  <p className="text-[0.84rem] text-[rgba(245,240,232,0.85)]">
                    Design an amazing landing page for me. That looks truly unique.
                  </p>
                </div>
              </div>
              {/* Agent activity */}
              <div className="flex items-center gap-2 mb-3">
                <SparkIcon className="h-4 w-4 text-accent" />
                <span className="text-[0.8rem] text-[rgba(245,240,232,0.55)] activity-shimmer">
                  Crafting brutalist editorial aesthetic with electric accents
                </span>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 text-[rgba(245,240,232,0.35)]"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-[0.8rem] text-[rgba(245,240,232,0.4)]">Reading frontend design skill</span>
              </div>
              {/* Agent text */}
              <div className="max-w-[90%] mb-5">
                <p className="font-serif text-[0.92rem] leading-[1.6] text-[rgba(245,240,232,0.78)]">
                  I&apos;ll go with a dark editorial brutalist aesthetic — bold serif type, vivid accent, grain texture,
                  kinetic animations, and a layout that breaks the usual grid.
                </p>
              </div>
              {/* Tool chips */}
              <div className="flex flex-wrap gap-2">
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-[0.74rem] text-[rgba(245,240,232,0.5)]">
                  Created landing.html
                </span>
                <span className="rounded-[8px] border border-[rgba(122,168,148,0.25)] bg-[rgba(122,168,148,0.08)] px-3 py-1.5 text-[0.74rem] text-accent-2">
                  Preview URL ready
                </span>
              </div>
            </div>
          </div>
          {/* Glow under the card */}
          <div
            className="pointer-events-none absolute -bottom-12 left-1/2 -translate-x-1/2 w-[80%] h-24 rounded-full opacity-20 blur-3xl"
            style={{ background: "linear-gradient(90deg, #dd7148, #7aa894)" }}
          />
        </div>
      </section>

      {/* ── Section gradient divider ── */}
      <div className="relative h-px w-full">
        <div
          className="absolute inset-0 mx-auto w-[60%] h-px"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(221,113,72,0.3), rgba(122,168,148,0.3), transparent)",
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════
          CAPABILITIES — Infinite scrolling marquee
          ═══════════════════════════════════════════ */}
      <section id="capabilities" className="relative py-28 max-[480px]:py-20">
        {/* Ambient glow behind capabilities */}
        <div
          className="pointer-events-none absolute top-[20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-[0.035]"
          style={{ background: "radial-gradient(circle, #dd7148 0%, transparent 65%)" }}
        />
        <div className="text-center mb-14 px-6" data-reveal>
          <h2 className="font-serif text-[clamp(1.8rem,4vw,2.4rem)] leading-[1.1] tracking-[-0.02em]">
            Everything you need in one workspace
          </h2>
          <p className="mt-4 mx-auto max-w-[520px] text-[0.92rem] leading-[1.55] text-[rgba(245,240,232,0.42)]">
            Conversational AI, research, code execution, and full development workflows — no context-switching.
          </p>
        </div>

        {/* Marquee container — edge fade masks + pause on hover */}
        <div className="relative group/marquee">
          {/* Left/right fade masks */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-20 z-10 bg-gradient-to-r from-[var(--background)] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-20 z-10 bg-gradient-to-l from-[var(--background)] to-transparent" />

          <div className="overflow-hidden">
            <div className="flex gap-4 w-max animate-[marquee-scroll_60s_linear_infinite] group-hover/marquee:[animation-play-state:paused]">
              {/* Render cards twice for seamless loop */}
              {[...CAPABILITIES, ...CAPABILITIES].map((cap, i) => (
                <div
                  key={`${cap.title}-${i}`}
                  className="group shrink-0 w-[280px] rounded-2xl border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.015)] p-5 transition-all duration-250 hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.035)]"
                >
                  <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-[rgba(255,255,255,0.06)] text-[rgba(245,240,232,0.55)] transition-colors duration-200 group-hover:text-accent group-hover:bg-[rgba(221,113,72,0.1)]">
                    {cap.icon}
                  </div>
                  <h3 className="text-[0.86rem] font-medium text-[rgba(245,240,232,0.88)] mb-1">{cap.title}</h3>
                  <p className="text-[0.78rem] leading-[1.5] text-[rgba(245,240,232,0.38)]">{cap.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section gradient divider ── */}
      <div className="relative h-px w-full">
        <div
          className="absolute inset-0 mx-auto w-[40%] h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(122,168,148,0.25), transparent)" }}
        />
      </div>

      {/* ═══════════════════════════════════════════
          TWO AGENTS
          ═══════════════════════════════════════════ */}
      <section className="relative px-6 py-28 max-[480px]:py-20">
        {/* Ambient glow */}
        <div
          className="pointer-events-none absolute top-[30%] right-[-8%] w-[450px] h-[450px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #7aa894 0%, transparent 65%)" }}
        />
        <div className="mx-auto max-w-[900px]">
          <div className="text-center mb-16" data-reveal>
            <h2 className="font-serif text-[clamp(1.8rem,4vw,2.4rem)] leading-[1.1] tracking-[-0.02em]">
              Two agents, one workflow
            </h2>
            <p className="mt-4 mx-auto max-w-[480px] text-[0.92rem] leading-[1.55] text-[rgba(245,240,232,0.42)]">
              A main agent handles research and orchestration. When you need code, it delegates to a specialized coding
              agent in a cloud sandbox.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Main agent */}
            <div
              data-reveal
              className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(160deg,rgba(30,29,27,0.5),rgba(20,19,17,0.7))] p-7"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="h-9 w-9 rounded-full bg-[rgba(221,113,72,0.12)] inline-grid place-items-center">
                  <SparkIcon className="h-4 w-4 text-accent" />
                </div>
                <div>
                  <h3 className="text-[0.92rem] font-medium text-[rgba(245,240,232,0.88)]">Main Agent</h3>
                  <p className="text-[0.75rem] text-[rgba(245,240,232,0.35)]">Conversational & research</p>
                </div>
              </div>
              <ul className="space-y-2">
                {MAIN_AGENT_FEATURES.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[0.82rem] text-[rgba(245,240,232,0.5)]">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Coding agent */}
            <div
              data-reveal
              style={{ transitionDelay: "80ms" }}
              className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(160deg,rgba(30,29,27,0.5),rgba(20,19,17,0.7))] p-7"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="h-9 w-9 rounded-full bg-[rgba(122,168,148,0.12)] inline-grid place-items-center">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 text-accent-2"
                  >
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[0.92rem] font-medium text-[rgba(245,240,232,0.88)]">Coding Agent</h3>
                  <p className="text-[0.75rem] text-[rgba(245,240,232,0.35)]">Cloud sandbox development</p>
                </div>
              </div>
              <ul className="space-y-2">
                {CODING_AGENT_FEATURES.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[0.82rem] text-[rgba(245,240,232,0.5)]">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-2 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section gradient divider ── */}
      <div className="relative h-px w-full">
        <div
          className="absolute inset-0 mx-auto w-[50%] h-px"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(221,113,72,0.2), rgba(122,168,148,0.2), transparent)",
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════
          TECH HIGHLIGHTS
          ═══════════════════════════════════════════ */}
      <section className="px-6 py-20 max-[480px]:py-14">
        <div className="mx-auto max-w-[900px]">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5" data-reveal>
            {TECH.map((item) => (
              <div key={item.label} className="text-center py-4">
                <div className="text-[0.95rem] font-medium text-[rgba(245,240,232,0.78)]">{item.label}</div>
                <div className="mt-1 text-[0.78rem] text-[rgba(245,240,232,0.35)]">{item.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section gradient divider ── */}
      <div className="relative h-px w-full">
        <div
          className="absolute inset-0 mx-auto w-[30%] h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(221,113,72,0.35), transparent)" }}
        />
      </div>

      {/* ═══════════════════════════════════════════
          BOTTOM CTA
          ═══════════════════════════════════════════ */}
      <section className="relative px-6 py-28 max-[480px]:py-20 overflow-hidden">
        {/* CTA ambient glow */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(ellipse, #dd7148 0%, transparent 60%)" }}
        />
        <div className="mx-auto max-w-[480px] text-center" data-reveal>
          <SparkIcon className="h-10 w-10 text-accent mx-auto mb-6" />
          <h2 className="font-serif text-[clamp(1.6rem,4vw,2.2rem)] leading-[1.12] tracking-[-0.02em]">
            Ready to get started?
          </h2>
          <p className="mt-3 text-[0.9rem] text-[rgba(245,240,232,0.42)]">Sign in to access your AI workspace.</p>
          <div className="mt-8">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 rounded-xl bg-accent px-8 py-3.5 text-[0.92rem] font-semibold text-background no-underline transition-all duration-200 hover:brightness-110 hover:shadow-[0_8px_32px_rgba(221,113,72,0.3)] active:scale-[0.98]"
            >
              Get Started
              <span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════ */}
      <footer className="px-6 py-8 border-t border-[rgba(255,255,255,0.04)]">
        <div className="mx-auto max-w-[1120px] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[rgba(245,240,232,0.28)]">
            <SparkIcon className="h-4 w-4" />
            <span className="text-[0.78rem]">Relay AI</span>
          </div>
          <span className="text-[0.72rem] text-[rgba(245,240,232,0.2)]">Powered by Claude</span>
        </div>
      </footer>

      {/* ── Keyframe animations ── */}
      <style jsx>{`
        @keyframes landing-fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes landing-float-in {
          from { opacity: 0; transform: translateY(40px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
