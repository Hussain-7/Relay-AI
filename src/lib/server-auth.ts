import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase";

export interface ServerSessionUser {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export async function getServerSessionUser(): Promise<ServerSessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  const profile = await prisma.userProfile.upsert({
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

  return {
    userId: profile.userId,
    email: profile.email,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
  };
}

export async function requireServerSessionUser(): Promise<ServerSessionUser> {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/sign-in");
  }
  return user;
}
