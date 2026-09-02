import { NextResponse } from "next/server";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
