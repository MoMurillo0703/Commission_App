import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const supabase = await createSupabaseServer();
  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
  const target = new URL("/forgot-password", request.url);
  target.searchParams.set(error ? "error" : "sent", error?.message ?? "1");
  return NextResponse.redirect(target, 303);
}
