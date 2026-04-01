import { isEmailAllowed } from "@/lib/allowed-emails";
import { env, hasSupabaseAuth } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export interface RequestUser {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

const USER_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_CACHE_MAX_SIZE = 500;
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
      if (!isEmailAllowed(user.email)) {
        throw new Error("Access denied — your account is not on the allowlist.");
      }
      await ensureUserProfile(user);
      return user;
    }
  }

  // 2. Fallback: dev header auth
  const allowHeader = env.ALLOW_INSECURE_USER_HEADER === true;

  if (!allowHeader) {
    throw new Error("Authentication required");
  }

  const requestedUserId = getHeaderString(headers, "x-user-id");
  const userId = requestedUserId ?? "demo-user";
  const email = getHeaderString(headers, "x-user-email") ?? `${userId}@relay-ai.local`;
  const fullName = getHeaderString(headers, "x-user-name");
  const avatarUrl = getHeaderString(headers, "x-user-avatar");

  const user = { userId, email, fullName, avatarUrl };
  await ensureUserProfile(user);
  return user;
}

/**
 * Fast user getter for Server Components (pages/layouts).
 * Decodes the Supabase JWT from cookies without an API call — just base64 parsing.
 * Returns null if not authenticated. Safe for non-auth-critical uses (greetings, UI hints).
 */
export async function getPageUser(): Promise<RequestUser | null> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();

    // Supabase cookie: sb-{ref}-auth-token (may be chunked as -auth-token.0, .1, etc.)
    const ref = env.NEXT_PUBLIC_SUPABASE_URL?.match(/\/\/([^.]+)\./)?.[1];
    if (!ref) return null;

    const baseName = `sb-${ref}-auth-token`;
    let raw = cookieStore.get(baseName)?.value;
    if (!raw) {
      // Try chunked cookies
      const chunks: string[] = [];
      for (let i = 0; ; i++) {
        const chunk = cookieStore.get(`${baseName}.${i}`)?.value;
        if (!chunk) break;
        chunks.push(chunk);
      }
      if (chunks.length > 0) raw = chunks.join("");
    }
    if (!raw) return null;

    // Parse the JWT payload (second segment) — no verification, just for display data
    const payload = raw.startsWith("base64-") ? raw.slice(7) : raw;
    const jwtParts = payload.split(".");
    if (jwtParts.length < 2) return null;

    const decoded = JSON.parse(Buffer.from(jwtParts[1]!, "base64url").toString());
    const meta = decoded.user_metadata ?? {};

    return {
      userId: decoded.sub ?? "",
      email: decoded.email ?? "",
      fullName: meta.full_name ?? meta.name ?? null,
      avatarUrl: meta.avatar_url ?? null,
    };
  } catch {
    return null;
  }
}

async function getSupabaseUser(): Promise<RequestUser | null> {
  try {
    // Dynamic import to avoid pulling in cookies() for non-Supabase paths
    const { getSupabaseServerClient } = await import("@/lib/supabase-server");
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
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
    try {
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
    } catch (err) {
      // Handle email uniqueness conflict — another userId already has this email
      // (e.g. switching from dev mode demo-user to real Supabase auth).
      // Reassign the existing profile to the new userId.
      if ((err as { code?: string }).code === "P2002") {
        await prisma.userProfile.update({
          where: { email: user.email },
          data: {
            userId: user.userId,
            fullName: user.fullName,
            avatarUrl: user.avatarUrl,
          },
        });
      } else {
        throw err;
      }
    }

    userExistsCache.set(user.userId, Date.now());

    // LRU eviction: prevent unbounded cache growth
    if (userExistsCache.size > USER_CACHE_MAX_SIZE) {
      const oldest = userExistsCache.keys().next().value;
      if (oldest) userExistsCache.delete(oldest);
    }
  }
}
