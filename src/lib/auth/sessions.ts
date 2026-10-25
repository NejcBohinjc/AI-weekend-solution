// Database-backed sessions. The cookie holds a random token; the database holds its hash.
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, sessions } from "@/db/schema";
import { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "session";
/**
 * Companion cookie: while it is present, the middleware does not look the session up again (pages always
 * validate it themselves). When it runs out the middleware checks the session once and renews it, so a
 * revoked session is noticed within CHECK_TTL at the latest, and by every page immediately.
 */
export const SESSION_CHECK_COOKIE = "session_check";
export const SESSION_CHECK_TTL_SECONDS = 6 * 60 * 60;
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

export function sessionCheckCookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_CHECK_TTL_SECONDS };
}

export async function createSession(memberId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), memberId, expiresAt });
  return { token, expiresAt };
}

/** departmentIds: every department the member is in (possibly none). */
export type SessionMember = Pick<typeof members.$inferSelect, "id" | "name" | "email" | "tier" | "weeklyHours" | "isAdmin"> & {
  departmentIds: number[];
};

type SessionRow = {
  expires_ms: string;
  id: number;
  name: string;
  email: string;
  tier: SessionMember["tier"];
  weekly_hours: number;
  is_admin: boolean;
  department_ids: number[] | null;
  unread: number;
};

/**
 * Looks up a session and its member (with every department the member is in, and the member's unread
 * notification count, which every page
 * header shows, so the layout needs no query of its own). Returns null if the session is unknown,
 * expired, or the member is deactivated. The admin flag is read fresh from the members table.
 *
 * This runs on every page view, so it is sent as one parameter-free statement: with prepared statements
 * off (required by Supabase's transaction pooler) the driver needs an extra round trip to learn the types
 * of a query's parameters, which would double the time of this lookup. The only value inlined is the
 * SHA-256 hash of the token, checked to be 64 hex characters, so nothing can be injected.
 *
 * `renew` extends a session in use once less than RENEW_WHEN_LEFT_MS is left (only the middleware and
 * login can set the cookie that goes with it, so pages pass false).
 */
export async function validateSessionToken(
  token: string,
  { renew = false }: { renew?: boolean } = {},
): Promise<{ member: SessionMember; unread: number; expiresAt: Date; renewed: boolean } | null> {
  const id = hashToken(token);
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const rows = (await db.execute(sql`
    select (extract(epoch from s.expires_at) * 1000)::text as expires_ms,
           m.id, m.name, m.email, m.tier, m.weekly_hours, m.is_admin,
           (select json_agg(md.department_id order by md.department_id) from member_departments md where md.member_id = m.id) as department_ids,
           (select count(*)::int from notifications n where n.member_id = m.id and n.read_at is null) as unread
    from sessions s
    join members m on m.id = s.member_id
    where s.id = ${sql.raw(`'${id}'`)} and s.expires_at > now() and m.active
    limit 1`)) as unknown as SessionRow[];
  const row = rows[0];
  if (!row) return null;
  const member: SessionMember = {
    id: row.id,
    name: row.name,
    email: row.email,
    tier: row.tier,
    weeklyHours: row.weekly_hours,
    isAdmin: row.is_admin,
    departmentIds: (row.department_ids ?? []).map(Number),
  };
  const expiresAt = new Date(Math.round(Number(row.expires_ms)));

  if (renew && expiresAt.getTime() - Date.now() < RENEW_WHEN_LEFT_MS) {
    const renewedAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt: renewedAt }).where(eq(sessions.id, id));
    return { member, unread: row.unread, expiresAt: renewedAt, renewed: true };
  }
  return { member, unread: row.unread, expiresAt, renewed: false };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Ends every session of a member (password change, deactivation). */
export async function invalidateMemberSessions(memberId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.memberId, memberId));
}
