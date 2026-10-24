// The single auth module. Today: pick-your-name-from-roster with a signed cookie.
// To switch to Google sign-in, replace signInAsMember() with an OAuth callback that
// looks the member up by verified email; everything else (session, roles) stays.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { members } from "@/db/schema";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_MAX_AGE, type Session } from "./session";

export type { Session };

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

/** For pages and actions: the signed-in member, or a redirect to /login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** For admin pages and actions. Middleware already guards /admin/*; this guards server actions too. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard?denied=admin");
  return session;
}

/** Full roster row for the signed-in member (fresh from the database). */
export async function getCurrentMember() {
  const session = await requireSession();
  const [member] = await db.select().from(members).where(eq(members.id, session.memberId)).limit(1);
  if (!member) redirect("/login");
  return member;
}

/** Roster shown on the login page. */
export async function listLoginMembers() {
  return db
    .select({ id: members.id, name: members.name, tier: members.tier, isAdmin: members.isAdmin })
    .from(members)
    .orderBy(asc(members.name));
}

/** Signs in as a roster member. Role comes from the roster's admin flag. */
export async function signInAsMember(memberId: number): Promise<boolean> {
  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) return false;
  const token = await encodeSession({ memberId: member.id, name: member.name, isAdmin: member.isAdmin });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return true;
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
