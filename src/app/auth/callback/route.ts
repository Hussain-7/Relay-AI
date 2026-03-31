import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/chat/new";

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Build the success redirect response first — cookies will be set on it
  const redirectUrl = new URL(next, origin);
  const response = NextResponse.redirect(redirectUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Read cookies from the incoming request (includes PKCE verifier)
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write cookies to the outgoing response
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback: code exchange failed:", error.message);
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "auth_failed");
    loginUrl.searchParams.set("next", next);
    const errorResponse = NextResponse.redirect(loginUrl);
    // Carry forward cookie changes (e.g. cleared PKCE verifier)
    for (const cookie of response.cookies.getAll()) {
      errorResponse.cookies.set(cookie);
    }
    return errorResponse;
  }

  return response;
}
