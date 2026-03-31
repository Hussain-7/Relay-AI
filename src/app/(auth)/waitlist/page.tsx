"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

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

export default function WaitlistPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }: { data: { user: { email?: string } | null } }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-[440px] text-center">
        <div className="mx-auto mb-8 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(221,113,72,0.12)]">
          <SparkIcon className="h-8 w-8 text-accent" />
        </div>

        <h1 className="font-serif text-[2rem] leading-[1.12] tracking-[-0.02em] text-[rgba(245,240,232,0.95)]">
          You&apos;re on the waitlist
        </h1>

        <p className="mt-4 text-[0.92rem] leading-[1.6] text-[rgba(245,240,232,0.5)]">
          Relay AI is currently invite-only. We&apos;ve noted your interest
          {email ? (
            <>
              {" "}
              at <span className="text-[rgba(245,240,232,0.75)] font-medium">{email}</span>
            </>
          ) : null}{" "}
          and will reach out when a spot opens up.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <div className="rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-2.5 w-2.5 rounded-full bg-[rgba(122,168,148,0.7)]" />
              <span className="text-[0.85rem] text-[rgba(245,240,232,0.7)]">Your spot is reserved</span>
            </div>
            {email ? (
              <p className="mt-2 text-[0.8rem] text-[rgba(245,240,232,0.38)] pl-[22px]">
                We&apos;ll send an invite to {email} when access is available.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 text-[0.82rem] text-[rgba(245,240,232,0.35)] hover:text-[rgba(245,240,232,0.6)] transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
