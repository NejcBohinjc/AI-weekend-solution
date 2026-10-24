// Limits failed sign-ins per email and per IP. Stored in Postgres so it holds across serverless instances.
import { and, count, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
// Higher than per email: the whole institute may sit behind one office IP.
export const MAX_FAILURES_PER_IP = 20;

export async function isRateLimited(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [[byEmail], [byIp]] = await Promise.all([
    db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.email, email), gt(loginAttempts.createdAt, since))),
    db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.createdAt, since))),
  ]);
  return byEmail.n >= MAX_FAILURES_PER_EMAIL || byIp.n >= MAX_FAILURES_PER_IP;
}

export async function recordFailure(email: string, ip: string): Promise<void> {
  await db.insert(loginAttempts).values({ email, ip });
  // Housekeeping: drop rows that can no longer affect any limit.
  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}

/** After a successful sign-in, earlier typos for that email no longer count. */
export async function clearFailures(email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
}
