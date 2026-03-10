import { redirect } from "next/navigation";

export default function Home() {
  // Middleware handles auth redirects:
  // - Authenticated → /chat/new
  // - Unauthenticated → /login
  // If middleware isn't running (dev without Supabase), go to chat directly.
  redirect("/chat/new");
}
