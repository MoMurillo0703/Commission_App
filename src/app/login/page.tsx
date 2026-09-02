import { redirect } from "next/navigation";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { safeLocalRedirect } from "@/lib/redirect";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  if (supabaseConfigured()) {
    try {
      const supabase = await createSupabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) redirect(safeLocalRedirect(params.next));
    } catch {
      // Show the form if auth is misconfigured.
    }
  }

  return (
    <main className="content" style={{ maxWidth: 480, margin: "80px auto" }}>
      <section className="panel">
        <p className="eyebrow">Demo access</p>
        <h1>Sign in</h1>
        <p>This hosted commissions demo requires a signed-in user. Commission data is not public.</p>
        {params.error && <p className="form-error">{params.error}</p>}
        <form className="form-grid" action="/auth/login" method="post">
          <input type="hidden" name="next" value={safeLocalRedirect(params.next)} />
          <label>
            Email
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" required />
          </label>
          <div className="form-actions">
            <button>Sign in</button>
          </div>
        </form>
      </section>
    </main>
  );
}
