import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, SESSION_COOKIE } from "@/lib/auth/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const session = await decodeSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete(SESSION_COOKIE); // clear stale or tampered cookies
    return res;
  }

  if ((pathname === "/admin" || pathname.startsWith("/admin/")) && !session.isAdmin) {
    return NextResponse.redirect(new URL("/dashboard?denied=admin", req.url));
  }

  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", req.url));
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
