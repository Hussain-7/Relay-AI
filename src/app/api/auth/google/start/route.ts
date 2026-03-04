import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

function appBaseUrl(request: NextRequest): string {
  return process.env.APP_URL ?? request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const redirectTo = `${appBaseUrl(request)}/api/auth/google/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    return NextResponse.json(
      {
        error: "Failed to initialize Google OAuth",
        details: error?.message ?? "No OAuth URL returned",
      },
      { status: 500 },
    );
  }

  return NextResponse.redirect(data.url);
}
