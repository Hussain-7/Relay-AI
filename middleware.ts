import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase auth is not configured, allow all requests (dev mode)
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Set cookies on the request (for downstream server components)
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Set cookies on the response (for the browser)
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // This call refreshes the session if the access token is expired
  // but the refresh token is still valid. The refreshed tokens are
  // written back to cookies via setAll above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Unauthenticated user trying to access /chat/* → redirect to /login
  if (!user && pathname.startsWith("/chat")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated user on /login → redirect to /chat/new
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/chat/new";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Run on all routes except static files, _next, and api/auth
    "/((?!_next/static|_next/image|favicon.ico|auth/callback|api/).*)",
  ],
};
