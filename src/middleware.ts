import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { ALLOWED_EMAILS } from "@/lib/allowed-emails";

// Routes that don't require auth at all — skip entirely
const SKIP_AUTH = new Set(["/auth/callback", "/waitlist"]);
// Routes that are public but should redirect to /chat/new if already authenticated
const REDIRECT_IF_AUTHED = new Set(["/", "/login"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth completely for callbacks, static assets, API routes
  if (
    SKIP_AUTH.has(pathname) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/preview/") ||
    pathname.endsWith(".webmanifest") ||
    pathname.endsWith(".svg") ||
    pathname === "/icon.svg" ||
    pathname === "/apple-icon.svg"
  ) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured, allow all requests (dev mode)
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Public routes (/, /login) — show the page as-is
    if (REDIRECT_IF_AUTHED.has(pathname)) {
      return response;
    }
    // Protected routes — redirect to login
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  // Authenticated but not on the allowlist → redirect to waitlist
  if (!user.email || !ALLOWED_EMAILS.has(user.email.toLowerCase())) {
    const url = request.nextUrl.clone();
    url.pathname = "/waitlist";
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  // Authenticated + allowed user on / or /login → redirect to chat
  if (REDIRECT_IF_AUTHED.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/chat/new";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
