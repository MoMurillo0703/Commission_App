import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim());
}

export async function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    throw new Error("Supabase Auth is not configured. See DEPLOYMENT.md.");
  }

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          cookieStore.set(cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });
}

export function allowedDemoEmails() {
  return (process.env.DEMO_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedDemoEmail(email: string | undefined) {
  const allowed = allowedDemoEmails();
  if (allowed.length === 0) return Boolean(email);
  return Boolean(email && allowed.includes(email.toLowerCase()));
}
