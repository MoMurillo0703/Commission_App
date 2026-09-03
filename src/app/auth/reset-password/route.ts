import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirmPassword") ?? "");
  if (password.length < 8 || password !== confirm) {
    return NextResponse.redirect(new URL("/reset-password?error=Passwords+must+match+and+contain+at+least+8+characters", request.url), 303);
  }
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return NextResponse.redirect(new URL(`/reset-password?error=${encodeURIComponent(error.message)}`, request.url), 303);
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?message=Password+updated.+Sign+in+again.", request.url), 303);
}
