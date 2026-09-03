import Link from "next/link";
import { notFound } from "next/navigation";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  if (process.env.ENABLE_REGISTRATION !== "true") notFound();
  const params = await searchParams;
  return <main className="content auth-page"><section className="panel"><p className="eyebrow">Demo registration</p><h1>Create an account</h1><p>Registration is enabled by the administrator. Access remains subject to the configured email allow list.</p>{params.error && <p className="form-error">{params.error}</p>}{params.sent && <p className="form-success">Check your email to confirm your account.</p>}<form className="form-grid" action="/auth/register" method="post"><label>Email<input type="email" name="email" required /></label><label>Password<input type="password" name="password" minLength={8} autoComplete="new-password" required /></label><button>Create account</button></form><p className="auth-links"><Link href="/login">Back to sign in</Link></p></section></main>;
}
