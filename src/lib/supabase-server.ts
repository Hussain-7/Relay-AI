import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // setAll is called from Server Components where cookies can't be set.
              // This is expected when refreshing tokens in middleware (which handles it).
            }
          }
        },
      },
    },
  );
}
