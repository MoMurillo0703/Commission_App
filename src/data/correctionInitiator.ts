import { ValidationError } from "@/lib/errors";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import type { CorrectionInitiator } from "./compensationCorrections";

export async function currentCorrectionInitiator(): Promise<CorrectionInitiator> {
  if (!supabaseConfigured()) {
    return { id: "local", email: null, name: "Local user" };
  }
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new ValidationError("Sign in is required to correct compensation.");
  const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: metadataName ?? user.email ?? user.id,
  };
}
