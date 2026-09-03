import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicPaths = ["/login", "/auth/callback", "/auth/login"];

function isPublic(pathname: string) {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function authConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim());
}

function allowedEmails() {
  return (process.env.DEMO_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function middleware(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (!authConfigured() || (process.env.VERCEL && allowedEmails().length === 0)) {
    if (process.env.VERCEL) {
      return new NextResponse("This demo is not configured. Set the Supabase environment variables in Vercel, including DEMO_ALLOWED_EMAILS.", { status: 503 });
    }
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) request.cookies.set(cookie.name, cookie.value);
          response = NextResponse.next({ request });
          for (const cookie of cookiesToSet) response.cookies.set(cookie.name, cookie.value, cookie.options);
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const allowed = allowedEmails();
  const permitted = Boolean(user?.email) && (allowed.length === 0 || allowed.includes(user!.email!.toLowerCase()));

  if (!user || !permitted) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ message: "Sign in is required." }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
