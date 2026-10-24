// One-time links for setting or resetting a password (no email service needed:
// an admin copies the link and sends it to the member).
import { and, eq, gt, isNull, TransactionRollbackError } from "drizzle-orm";
import { db } from "@/db";
import { members, passwordTokens, sessions } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { hashPassword } from "./password";
import { generateToken, hashToken } from "./tokens";

export const SETUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Creates a new link for a member and cancels any earlier unused ones. The link is not stored. */
export async function createSetupLink(memberId: number): Promise<{ url: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(passwordTokens).where(and(eq(passwordTokens.memberId, memberId), isNull(passwordTokens.usedAt)));
    await tx.insert(passwordTokens).values({ tokenHash: hashToken(token), memberId, expiresAt });
  });
  return { url: `${appUrl()}/set-password?token=${token}`, expiresAt };
}

const validToken = (token: string) =>
  and(eq(passwordTokens.tokenHash, hashToken(token)), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, new Date()));

/** The member a still-valid link belongs to, or null if the link is unknown, used, expired, or the member is inactive. */
export async function getSetupLinkMember(token: string) {
  const [row] = await db
    .select({ id: members.id, name: members.name, email: members.email })
    .from(passwordTokens)
    .innerJoin(members, eq(passwordTokens.memberId, members.id))
    .where(and(validToken(token), eq(members.active, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Uses up the link and sets the password in one transaction. Ends all of the member's
 * sessions and cancels their other links. Returns the member id, or null if the link is not valid.
 */
export async function setPasswordWithLink(token: string, password: string): Promise<number | null> {
  const passwordHash = await hashPassword(password);
  try {
    return await setPasswordInTransaction(token, passwordHash);
  } catch (err) {
    if (err instanceof TransactionRollbackError) return null;
    throw err;
  }
}

function setPasswordInTransaction(token: string, passwordHash: string) {
  return db.transaction(async (tx) => {
    // Marking it used in the same statement that checks it makes the link single-use under concurrency.
    const [used] = await tx
      .update(passwordTokens)
      .set({ usedAt: new Date() })
      .where(validToken(token))
      .returning({ memberId: passwordTokens.memberId });
    if (!used) return null;

    const [member] = await tx
      .update(members)
      .set({ passwordHash, updatedAt: new Date() })
      .where(and(eq(members.id, used.memberId), eq(members.active, true)))
      .returning({ id: members.id });
    if (!member) tx.rollback(); // deactivated meanwhile: leave the link unused
    await tx.delete(sessions).where(eq(sessions.memberId, member.id));
    await tx.delete(passwordTokens).where(and(eq(passwordTokens.memberId, member.id), isNull(passwordTokens.usedAt)));
    return member.id;
  });
}
