// Server-side auth entry point for pages and actions. Email + password, database sessions.
// Building blocks live next to this file: password.ts, sessions.ts, setup-links.ts, rate-limit.ts.
import "server-only";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { members } from "@/db/schema";
import { verifyPassword } from "./password";
import { clearFailures, isRateLimited, recordFailure } from "./rate-limit";
import {
  createSession,
  invalidateSession,
  SESSION_CHECK_COOKIE,
  SESSION_COOKIE,
  sessionCheckCookieOptions,
  sessionCookieOptions,
  validateSessionToken,
  type SessionMember,
} from "./sessions";

export type { SessionMember };

/**
 * The signed-in member (and their unread notification count) for this request, or null. One query,
 * cached for the whole request: the layout, the page and any component below them share it.
 */
export const getCurrentSession = cache(async (): Promise<{ member: SessionMember; unread: number } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await validateSessionToken(token);
  return session && { member: session.member, unread: session.unread };
});

/** The signed-in member for this request, or null. Cached per request. */
export async function getCurrentMember(): Promise<SessionMember | null> {
  return (await getCurrentSession())?.member ?? null;
}

export async function requireSession(): Promise<{ member: SessionMember; unread: number }> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireMember(): Promise<SessionMember> {
  return (await requireSession()).member;
}

/** Middleware already guards /admin/*; this also guards admin server actions. */
export async function requireAdmin(): Promise<SessionMember> {
  const member = await requireMember();
  if (!member.isAdmin) redirect("/forbidden");
  return member;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  // On Vercel x-real-ip / x-forwarded-for are set by the platform and cannot be spoofed by the client.
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export type SignInResult = "ok" | "invalid" | "rate_limited";

export async function signInWithPassword(rawEmail: string, password: string): Promise<SignInResult> {
  const email = rawEmail.trim().toLowerCase();
  const ip = await clientIp();
  if (await isRateLimited(email, ip)) return "rate_limited";

  const [member] = await db
    .select({ id: members.id, active: members.active, passwordHash: members.passwordHash })
    .from(members)
    .where(eq(members.email, email))
    .limit(1);
  // Always verify (against a dummy hash if needed) so timing is the same for unknown emails.
  const passwordOk = await verifyPassword(member?.passwordHash ?? null, password);
  if (!member || !member.active || !passwordOk) {
    await recordFailure(email, ip);
    return "invalid";
  }

  await clearFailures(email);
  await startSession(member.id);
  return "ok";
}

export async function startSession(memberId: number): Promise<void> {
  const { token, expiresAt } = await createSession(memberId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  store.set(SESSION_CHECK_COOKIE, "1", sessionCheckCookieOptions());
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  store.delete(SESSION_COOKIE);
  store.delete(SESSION_CHECK_COOKIE);
}
