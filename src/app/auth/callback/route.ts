import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { safeLocalRedirect } from "@/lib/redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeLocalRedirect(url.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL("/login?error=Missing+authentication+code", request.url));
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
