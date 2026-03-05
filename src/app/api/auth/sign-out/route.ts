import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

function appBaseUrl(request: NextRequest): string {
  return process.env.APP_URL ?? request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  return NextResponse.json({
    ok: true,
    redirectTo: `${appBaseUrl(request)}/`,
  });
}
