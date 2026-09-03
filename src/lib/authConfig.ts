export const publicAuthPaths = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/register",
  "/auth/callback",
  "/auth/login",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/register",
  "/auth/signout",
];

export function isPublicAuthPath(pathname: string) {
  return publicAuthPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function registrationEnabled() {
  return process.env.ENABLE_REGISTRATION === "true";
}

export function signInErrorMessage(message: string | undefined) {
  if (!message) return "Unable to sign in. Check your email and password.";
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "Confirm your email, then sign in again.";
  return message;
}
