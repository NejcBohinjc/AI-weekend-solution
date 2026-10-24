import { NextResponse, type NextRequest } from "next/server";
import { SESSION_CHECK_COOKIE, SESSION_COOKIE, sessionCheckCookieOptions, sessionCookieOptions, validateSessionToken } from "@/lib/auth/sessions";

const PUBLIC_PATHS = new Set(["/login", "/set-password"]);

/**
 * The middleware only decides "signed in or not" from the cookie, without a database query, so it adds no
 * waiting to a page view. Every page, route and server action validates the session itself
 * (requireMember / requireAdmin: one cached query per request). Once every few hours (when the companion
 * cookie has run out) it checks the session for real, which also renews it and removes a dead one.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Scheduled jobs authenticate with CRON_SECRET in the route itself, not with a session.
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.has(pathname);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const toLogin = () => (isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/login", req.url)));

  if (!token) return toLogin();

  if (!req.cookies.get(SESSION_CHECK_COOKIE)) {
    const session = await validateSessionToken(token, { renew: true });
    if (!session) {
      const res = toLogin(); // expired, revoked or tampered
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    const res = pathname === "/" ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();
    if (session.renewed) res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
    res.cookies.set(SESSION_CHECK_COOKIE, "1", sessionCheckCookieOptions());
    return res;
  }

  return pathname === "/" ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();
}

export const config = {
  // Node.js runtime so the occasional session check can use Postgres.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
