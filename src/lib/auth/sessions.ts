// Database-backed sessions. The cookie holds a random token; the database holds its hash.
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { members, sessions } from "@/db/schema";
import { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "session";
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
// Sessions in use are extended once less than this much time is left.
const RENEW_WHEN_LEFT_MS = 15 * DAY_MS;

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function createSession(memberId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), memberId, expiresAt });
  return { token, expiresAt };
}

export type SessionMember = Pick<typeof members.$inferSelect, "id" | "name" | "email" | "tier" | "weeklyHours" | "isAdmin">;

/**
 * Looks up a session and its member. Returns null if the session is unknown, expired,
 * or the member is deactivated. The admin flag is read fresh from the members table.
 */
export async function validateSessionToken(
  token: string,
): Promise<{ member: SessionMember; expiresAt: Date; renewed: boolean } | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      member: {
        id: members.id,
        name: members.name,
        email: members.email,
        tier: members.tier,
        weeklyHours: members.weeklyHours,
        isAdmin: members.isAdmin,
      },
    })
    .from(sessions)
    .innerJoin(members, eq(sessions.memberId, members.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), eq(members.active, true)))
    .limit(1);
  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < RENEW_WHEN_LEFT_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    return { member: row.member, expiresAt, renewed: true };
  }
  return { member: row.member, expiresAt: row.expiresAt, renewed: false };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Ends every session of a member (password change, deactivation). */
export async function invalidateMemberSessions(memberId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.memberId, memberId));
}
