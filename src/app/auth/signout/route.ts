import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?signedOut=1", request.url), 303);
  if (supabaseConfigured()) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => cookies.forEach((cookie) => response.cookies.set(cookie.name, cookie.value, cookie.options)),
      },
    });
    await supabase.auth.signOut({ scope: "local" });
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) response.cookies.delete(cookie.name);
    }
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
