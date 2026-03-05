import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase";

function appBaseUrl(request: NextRequest): string {
  return process.env.APP_URL ?? request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const baseUrl = appBaseUrl(request);
  const code = request.nextUrl.searchParams.get("code");
  const authError = request.nextUrl.searchParams.get("error_description");

  if (authError) {
    return NextResponse.redirect(
      `${baseUrl}/sign-in?auth_error=${encodeURIComponent(authError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/sign-in?auth_error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/sign-in?auth_error=${encodeURIComponent(error.message)}`,
    );
  }

  if (data.user) {
    await prisma.userProfile.upsert({
      where: { userId: data.user.id },
      update: {
        email: data.user.email ?? `${data.user.id}@local.invalid`,
        fullName: data.user.user_metadata?.full_name ?? null,
        avatarUrl: data.user.user_metadata?.avatar_url ?? null,
      },
      create: {
        userId: data.user.id,
        email: data.user.email ?? `${data.user.id}@local.invalid`,
        fullName: data.user.user_metadata?.full_name ?? null,
        avatarUrl: data.user.user_metadata?.avatar_url ?? null,
      },
    });
  }

  return NextResponse.redirect(`${baseUrl}/onboarding?auth=google_connected`);
}
