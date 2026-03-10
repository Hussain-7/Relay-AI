import { env } from "@/lib/env";
import { hasSupabaseAuth } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export interface RequestUser {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

const USER_CACHE_TTL_MS = 5 * 60 * 1000;
const userExistsCache = new Map<string, number>();

function getHeaderString(headers: Headers, name: string) {
  const value = headers.get(name);

  return value?.trim() ? value.trim() : null;
}

export async function requireRequestUser(headers: Headers): Promise<RequestUser> {
  // 1. Try Supabase session (production path)
  if (hasSupabaseAuth()) {
    const user = await getSupabaseUser();
    if (user) {
      await ensureUserProfile(user);
      return user;
    }
  }

  // 2. Fallback: dev header auth
  const allowHeader =
    env.ALLOW_INSECURE_USER_HEADER || env.NODE_ENV === "development" || env.NODE_ENV === "test";

  if (!allowHeader) {
    throw new Error("Authentication required");
  }

  const requestedUserId = getHeaderString(headers, "x-user-id");
  const userId = requestedUserId ?? "demo-user";
  const email =
    getHeaderString(headers, "x-user-email") ?? `${userId}@relay-ai.local`;
  const fullName = getHeaderString(headers, "x-user-name");
  const avatarUrl = getHeaderString(headers, "x-user-avatar");

  const user = { userId, email, fullName, avatarUrl };
  await ensureUserProfile(user);
  return user;
}

async function getSupabaseUser(): Promise<RequestUser | null> {
  try {
    // Dynamic import to avoid pulling in cookies() for non-Supabase paths
    const { getSupabaseServerClient } = await import("@/lib/supabase-server");
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.email) {
      return null;
    }

    return {
      userId: user.id,
      email: user.email,
      fullName: (user.user_metadata?.full_name as string) ?? null,
      avatarUrl: (user.user_metadata?.avatar_url as string) ?? null,
    };
  } catch {
    return null;
  }
}

async function ensureUserProfile(user: RequestUser) {
  const cachedAt = userExistsCache.get(user.userId);
  const isCached = cachedAt !== undefined && Date.now() - cachedAt < USER_CACHE_TTL_MS;

  if (!isCached) {
    await prisma.userProfile.upsert({
      where: { userId: user.userId },
      update: {
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
      create: {
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
    });

    userExistsCache.set(user.userId, Date.now());
  }
}
