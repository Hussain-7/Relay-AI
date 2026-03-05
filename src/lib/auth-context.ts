import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createSupabasePublicClient,
  createSupabaseServerClient,
} from "@/lib/supabase";

export type AuthSource = "supabase" | "header" | "query" | "body";

export interface AuthContext {
  userId: string;
  email?: string;
  source: AuthSource;
}

function canUseInsecureHeaderFallback(): boolean {
  if (process.env.ALLOW_INSECURE_USER_HEADER === "true") {
    return true;
  }

  if (process.env.ALLOW_INSECURE_USER_HEADER === "false") {
    return false;
  }

  return process.env.NODE_ENV !== "production";
}

async function resolveSupabaseUser(
  request: NextRequest,
): Promise<AuthContext | null> {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!bearerToken) {
    return null;
  }

  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error) {
    throw new Error("Unauthorized: invalid Supabase access token");
  }
  if (!data.user) {
    return null;
  }

  await upsertUserProfile(data.user);

  return {
    userId: data.user.id,
    email: data.user.email ?? undefined,
    source: "supabase",
  };
}

async function resolveSupabaseUserFromCookie(): Promise<AuthContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  await upsertUserProfile(data.user);

  return {
    userId: data.user.id,
    email: data.user.email ?? undefined,
    source: "supabase",
  };
}

async function upsertUserProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}): Promise<void> {
  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      email: user.email ?? `${user.id}@local.invalid`,
      fullName: user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    },
    create: {
      userId: user.id,
      email: user.email ?? `${user.id}@local.invalid`,
      fullName: user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    },
  });
}

export async function resolveAuthContext(
  request: NextRequest,
  bodyUserId?: string | null,
): Promise<AuthContext> {
  const supabaseUser = await resolveSupabaseUser(request);
  if (supabaseUser) {
    return supabaseUser;
  }

  const cookieUser = await resolveSupabaseUserFromCookie();
  if (cookieUser) {
    return cookieUser;
  }

  if (!canUseInsecureHeaderFallback()) {
    throw new Error("Unauthorized: missing bearer token");
  }

  const headerUserId = request.headers.get("x-user-id");
  const queryUserId = request.nextUrl.searchParams.get("userId");
  const candidate = bodyUserId ?? headerUserId ?? queryUserId;

  if (!candidate) {
    throw new Error("Unauthorized: missing user context");
  }

  return {
    userId: candidate,
    source: bodyUserId ? "body" : headerUserId ? "header" : "query",
  };
}
