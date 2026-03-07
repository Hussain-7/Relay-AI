import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export interface RequestUser {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

function getHeaderString(headers: Headers, name: string) {
  const value = headers.get(name);

  return value?.trim() ? value.trim() : null;
}

export async function requireRequestUser(headers: Headers): Promise<RequestUser> {
  const allowHeader =
    env.ALLOW_INSECURE_USER_HEADER || env.NODE_ENV === "development" || env.NODE_ENV === "test";

  const requestedUserId = allowHeader ? getHeaderString(headers, "x-user-id") : null;
  const userId = requestedUserId ?? "demo-user";
  const email =
    (allowHeader ? getHeaderString(headers, "x-user-email") : null) ?? `${userId}@endless-dev.local`;
  const fullName = allowHeader ? getHeaderString(headers, "x-user-name") : null;
  const avatarUrl = allowHeader ? getHeaderString(headers, "x-user-avatar") : null;

  await prisma.userProfile.upsert({
    where: { userId },
    update: {
      email,
      fullName,
      avatarUrl,
    },
    create: {
      userId,
      email,
      fullName,
      avatarUrl,
    },
  });

  return { userId, email, fullName, avatarUrl };
}
