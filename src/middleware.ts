import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions, validateSessionToken } from "@/lib/auth/sessions";

const PUBLIC_PATHS = new Set(["/login", "/set-password"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Scheduled jobs authenticate with CRON_SECRET in the route itself, not with a session.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await validateSessionToken(token) : null;

  let res: NextResponse;
  if (PUBLIC_PATHS.has(pathname)) {
    res = pathname === "/login" && session ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();
  } else if (!session) {
    res = NextResponse.redirect(new URL("/login", req.url));
  } else if ((pathname === "/admin" || pathname.startsWith("/admin/")) && !session.member.isAdmin) {
    res = NextResponse.rewrite(new URL("/forbidden", req.url), { status: 403 });
  } else if (pathname === "/") {
    res = NextResponse.redirect(new URL("/dashboard", req.url));
  } else {
    res = NextResponse.next();
  }

  if (token && !session) res.cookies.delete(SESSION_COOKIE); // expired, revoked or tampered
  if (token && session?.renewed) res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  return res;
}

export const config = {
  // Node.js runtime so the middleware can check sessions in Postgres on every request.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
