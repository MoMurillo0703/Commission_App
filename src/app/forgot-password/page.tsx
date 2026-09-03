import Link from "next/link";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const params = await searchParams;
  return <main className="content auth-page"><section className="panel"><p className="eyebrow">Account recovery</p><h1>Reset password</h1><p>Enter your approved demo email. Supabase will send a secure password-reset link.</p>{params.error && <p className="form-error">{params.error}</p>}{params.sent && <p className="form-success">Check your email for the password-reset link.</p>}<form className="form-grid" action="/auth/forgot-password" method="post"><label>Email<input type="email" name="email" autoComplete="email" required /></label><button>Send reset link</button></form><p className="auth-links"><Link href="/login">Back to sign in</Link></p></section></main>;
}
