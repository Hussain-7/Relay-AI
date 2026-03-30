"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useEmailAuth, useGoogleAuth } from "@/hooks/useAuth";

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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);

  const google = useGoogleAuth(next);
  const emailAuth = useEmailAuth(next);
  const isLoading = google.isLoading || emailAuth.isLoading;
  const authError = emailAuth.error;

  return (
    <div className="bg-background text-foreground">
      <section className="relative flex h-dvh flex-col lg:flex-row">
        {/* Left — branding + sign-in */}
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 lg:py-0">
          <div className="w-full max-w-[420px]">
            <Link href="/" className="mb-10 flex items-center gap-3 no-underline">
              <SparkIcon className="h-8 w-8 text-accent" />
              <span className="text-[1.15rem] font-semibold tracking-[-0.02em]">Relay AI</span>
            </Link>

            <h1 className="font-serif text-[2.6rem] leading-[1.08] tracking-[-0.03em] text-[rgba(245,240,232,0.95)] max-[480px]:text-[2rem]">
              Think fast,
              <br />
              build faster
            </h1>
            <p className="mt-4 text-[0.95rem] leading-[1.55] text-[rgba(245,240,232,0.5)] max-w-[360px]">
              An AI workspace that combines chat, deep research, file handling, document generation, and remote coding
              sessions — all powered by Claude.
            </p>

            <div className="mt-10 flex flex-col gap-3">
              <button
                type="button"
                onClick={google.signIn}
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-5 py-3 text-[0.9rem] font-medium text-[rgba(245,240,232,0.92)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.18)] active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <GoogleIcon />
                {isLoading ? "Redirecting..." : "Continue with Google"}
              </button>

              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
                <span className="text-[0.75rem] text-[rgba(245,240,232,0.25)]">or</span>
                <div className="flex-1 h-px bg-[rgba(255,255,255,0.08)]" />
              </div>

              {!showEmailForm ? (
                <button
                  type="button"
                  onClick={() => setShowEmailForm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(255,255,255,0.08)] bg-transparent px-5 py-2.5 text-[0.85rem] text-[rgba(245,240,232,0.5)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.04)] hover:text-[rgba(245,240,232,0.7)] cursor-pointer"
                >
                  Sign in with email
                </button>
              ) : (
                <form
                  onSubmit={(e: React.FormEvent) => {
                    e.preventDefault();
                    emailAuth.signIn(email, password);
                  }}
                  className="flex flex-col gap-2.5"
                >
                  <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    className="w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-[0.88rem] text-[rgba(245,240,232,0.92)] placeholder:text-[rgba(245,240,232,0.25)] outline-none focus:border-[rgba(212,112,73,0.4)] transition-colors"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="w-full rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-[0.88rem] text-[rgba(245,240,232,0.92)] placeholder:text-[rgba(245,240,232,0.25)] outline-none focus:border-[rgba(212,112,73,0.4)] transition-colors"
                  />
                  {authError && <p className="text-[0.8rem] text-[rgba(220,80,80,0.85)] m-0">{authError}</p>}
                  <button
                    type="submit"
                    disabled={isLoading || !email.trim() || !password.trim()}
                    className="flex w-full items-center justify-center rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-5 py-2.5 text-[0.88rem] font-medium text-[rgba(245,240,232,0.92)] transition-all duration-150 hover:bg-[rgba(255,255,255,0.1)] active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isLoading ? "Signing in..." : "Sign in"}
                  </button>
                </form>
              )}
            </div>

            <p className="mt-5 text-[0.78rem] text-[rgba(245,240,232,0.28)]">Access is currently invite-only.</p>
          </div>
        </div>

        {/* Right — decorative mock UI */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-12">
          <div className="relative w-full max-w-[520px] aspect-[4/3] rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(145deg,rgba(30,29,27,0.95),rgba(22,21,19,0.98))] shadow-[0_40px_120px_rgba(0,0,0,0.4)] overflow-hidden">
            <div className="absolute inset-0 flex flex-col p-6">
              <div className="flex gap-1 self-center rounded-full bg-[rgba(255,255,255,0.06)] p-1 mb-6">
                <span className="rounded-full bg-[rgba(255,255,255,0.1)] px-5 py-1.5 text-[0.78rem] text-[rgba(245,240,232,0.8)]">
                  Chat
                </span>
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
                  I&apos;ve refactored the auth middleware into a clean session-based pattern, added tests, and opened
                  PR #42 with the changes.
                </p>
              </div>
              <div className="flex gap-2 mb-4">
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[0.72rem] text-[rgba(245,240,232,0.55)]">
                  auth.ts
                </span>
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[0.72rem] text-[rgba(245,240,232,0.55)]">
                  session.ts
                </span>
                <span className="rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[0.72rem] text-[rgba(245,240,232,0.55)]">
                  +3 files
                </span>
              </div>
              <div className="mt-auto flex items-center gap-2 ml-1">
                <span className="pending-spark-pulse inline-grid place-items-center text-accent">
                  <SparkIcon className="h-4 w-4" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
