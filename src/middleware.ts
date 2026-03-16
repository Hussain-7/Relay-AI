import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = new Set(["/login", "/auth/callback"]);

const ALLOWED_EMAILS = new Set([
  "hussain2000.rizvi@gmail.com",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth check for public routes and API routes (API routes handle their own auth)
  if (PUBLIC_ROUTES.has(pathname) || pathname.startsWith("/api/")) {
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

  // This refreshes the session if needed and checks auth
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.email || !ALLOWED_EMAILS.has(user.email.toLowerCase())) {
    // Sign out unauthorized users so they don't get stuck in a redirect loop
    if (user && user.email && !ALLOWED_EMAILS.has(user.email.toLowerCase())) {
      await supabase.auth.signOut();
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
