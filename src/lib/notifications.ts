// In-app notifications. Every query is scoped to one member: a notification is only ever shown to the
// member it belongs to. Never put admin-only information into the text.
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

type Db = Pick<typeof db, "insert" | "select" | "update">;

export async function notify(memberId: number, n: { type: string; text: string; link?: string | null }, tx: Db = db): Promise<void> {
  await tx.insert(notifications).values({ memberId, type: n.type, text: n.text, link: n.link ?? null });
}

export async function unreadCount(memberId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export function listNotifications(memberId: number, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.memberId, memberId)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(limit);
}

/** Marks one of the member's own notifications read and returns its link (null if it is not theirs). */
export async function readNotification(memberId: number, id: number): Promise<{ link: string | null } | null> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.memberId, memberId)))
    .returning({ link: notifications.link });
  return row ?? null;
}

export async function markAllRead(memberId: number): Promise<void> {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.memberId, memberId), isNull(notifications.readAt)));
}
