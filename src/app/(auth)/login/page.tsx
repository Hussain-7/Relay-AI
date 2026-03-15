"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);

  async function handleGoogleSignIn() {
    setIsLoading(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Left — branding + sign-in */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          {/* Logo */}
          <div className="mb-12 flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-accent" aria-hidden="true">
              <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
              <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" transform="rotate(45 12 12)" />
            </svg>
            <span className="text-[1.15rem] font-semibold tracking-[-0.02em]">Relay AI</span>
          </div>

          {/* Headline */}
          <h1 className="font-serif text-[2.4rem] leading-[1.1] tracking-[-0.03em] text-[rgba(245,240,232,0.95)] max-[480px]:text-[1.9rem]">
            Think fast,<br />
            build faster
          </h1>
          <p className="mt-3 text-[0.95rem] leading-[1.5] text-[rgba(245,240,232,0.5)] max-w-[340px]">
            Your AI workspace for chat, research, and coding — powered by Claude.
          </p>

          {/* Google sign-in */}
          <div className="mt-10">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-5 py-2.5 text-[0.88rem] font-medium text-[rgba(245,240,232,0.92)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.18)] active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              {isLoading ? "Redirecting..." : "Continue with Google"}
            </button>
          </div>

          <p className="mt-6 text-[0.78rem] text-[rgba(245,240,232,0.32)]">
            By continuing, you agree to our terms of service.
          </p>
        </div>
      </div>

      {/* Right — decorative preview */}
      <div className="hidden lg:flex flex-1 items-center justify-center p-12">
        <div className="relative w-full max-w-[520px] aspect-[4/3] rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(145deg,rgba(30,29,27,0.95),rgba(22,21,19,0.98))] shadow-[0_40px_120px_rgba(0,0,0,0.4)] overflow-hidden">
          {/* Mock chat UI */}
          <div className="absolute inset-0 flex flex-col p-6">
            {/* Tab bar */}
            <div className="flex gap-1 self-center rounded-full bg-[rgba(255,255,255,0.06)] p-1 mb-6">
              <span className="rounded-full bg-[rgba(255,255,255,0.1)] px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.8)]">Chat</span>
              <span className="rounded-full px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.35)]">Research</span>
              <span className="rounded-full px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.35)]">Code</span>
            </div>

            {/* User message */}
            <div className="self-end max-w-[75%] rounded-[16px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.06)] px-4 py-2.5 mb-4">
              <p className="text-[0.82rem] text-[rgba(245,240,232,0.85)]">How should I structure this project proposal?</p>
            </div>

            {/* Agent activity */}
            <div className="flex items-center gap-2 mb-3 ml-1">
              <span className="text-[rgba(245,240,232,0.4)] text-[0.75rem]">Searched 3 sites</span>
              <span className="text-[rgba(245,240,232,0.2)]">&middot;</span>
              <span className="text-[rgba(245,240,232,0.4)] text-[0.75rem]">Reasoned through the answer</span>
            </div>

            {/* Assistant message */}
            <div className="max-w-[85%] mb-4">
              <p className="text-[0.82rem] leading-[1.55] text-[rgba(245,240,232,0.72)]">
                I&apos;d go with: Problem &rarr; Solution &rarr; Timeline &rarr; Ask. Keep it tight &mdash; one page max. The trick is making the problem feel urgent before you pitch the fix.
              </p>
            </div>

            {/* Spark pulse */}
            <div className="mt-auto flex items-center gap-2 ml-1">
              <span className="pending-spark-pulse inline-grid place-items-center text-accent">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" />
                  <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="currentColor" transform="rotate(45 12 12)" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
