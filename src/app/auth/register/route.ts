import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (process.env.ENABLE_REGISTRATION !== "true") return new NextResponse("Registration is disabled.", { status: 404 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const supabase = await createSupabaseServer();
  const origin = new URL(request.url).origin;
  const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback` } });
  const target = new URL("/register", request.url);
  target.searchParams.set(error ? "error" : "sent", error?.message ?? "1");
  return NextResponse.redirect(target, 303);
}
