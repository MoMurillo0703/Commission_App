import { NextResponse } from "next/server";
import { createSupabaseServer, isAllowedDemoEmail } from "@/lib/supabase/server";
import { signInErrorMessage } from "@/lib/authConfig";
import { safeLocalRedirect } from "@/lib/redirect";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const nextPath = safeLocalRedirect(String(form.get("next") ?? "/"));
  const login = new URL("/login", request.url);
  login.searchParams.set("next", nextPath);

  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      login.searchParams.set("error", signInErrorMessage(error?.message));
      return NextResponse.redirect(login, 303);
    }
    if (!isAllowedDemoEmail(data.user.email)) {
      await supabase.auth.signOut();
      login.searchParams.set("error", "This account is not allowed to use the demo.");
      return NextResponse.redirect(login, 303);
    }
    return NextResponse.redirect(new URL(nextPath, request.url), 303);
  } catch (error) {
    login.searchParams.set("error", signInErrorMessage(error instanceof Error ? error.message : undefined));
    return NextResponse.redirect(login, 303);
  }
}
