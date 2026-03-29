import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function useGoogleAuth(next: string) {
  const [isLoading, setIsLoading] = useState(false);

  async function signIn() {
    setIsLoading(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return { isLoading, signIn };
}

export function useEmailAuth(next: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(email: string, password: string) {
    if (!email.trim() || !password.trim()) return;
    setIsLoading(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    if (authError) {
      setError(authError.message);
      setIsLoading(false);
    } else {
      window.location.href = next;
    }
  }

  return { isLoading, error, signIn };
}
