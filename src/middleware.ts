import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { ALLOWED_EMAILS } from "@/lib/allowed-emails";

const PUBLIC_ROUTES = new Set(["/", "/login", "/auth/callback", "/waitlist"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for public routes, API routes, and static assets
  if (
    PUBLIC_ROUTES.has(pathname) ||
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

  // Not authenticated → redirect to login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(url);
    // Carry forward cookie changes (e.g. cleared stale tokens) so the
    // browser doesn't keep sending an invalid refresh token on every request.
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

  // Authenticated + allowed user on /login → redirect to chat
  if (pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/chat/new";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
