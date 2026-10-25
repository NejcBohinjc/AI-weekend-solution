// System-wide settings, changed by admins on Admin → Settings. Stored in app_settings (one row per
// setting); a missing row means the default.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, taskEvents, tasks } from "@/db/schema";

/** Whether tasks the AI creates from meeting notes wait for the assignee to confirm them (default: yes). */
const AI_CONFIRMATION = "ai_tasks_need_confirmation";

type Db = Pick<typeof db, "select">;

export async function aiTasksNeedConfirmation(tx: Db = db): Promise<boolean> {
  const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, AI_CONFIRMATION)).limit(1);
  return row ? row.value === true : true;
}

export async function aiConfirmationSetting(): Promise<{ required: boolean; updatedAt: Date | null; updatedById: number | null }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, AI_CONFIRMATION)).limit(1);
  return { required: row ? row.value === true : true, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
}

/**
 * Turns confirming AI tasks on or off. Turning it off also accepts the AI tasks still waiting for review
 * (their history says so), since nobody would be asked to review them any more. Returns how many.
 */
export async function setAiTasksNeedConfirmation(required: boolean, adminId: number): Promise<{ accepted: number }> {
  return db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: AI_CONFIRMATION, value: required, updatedById: adminId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: required, updatedById: adminId, updatedAt: new Date() } });
    if (required) return { accepted: 0 };
    const waiting = await tx
      .update(tasks)
      .set({ aiConfirmedAt: new Date() })
      .where(and(eq(tasks.createdByAi, true), isNull(tasks.aiConfirmedAt), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    if (waiting.length) {
      await tx.insert(taskEvents).values(
        waiting.map((t) => ({
          taskId: t.id,
          actorId: adminId,
          source: "app" as const,
          kind: "confirmed" as const,
          newValue: "Accepted automatically: an admin turned off confirming AI-created tasks",
        })),
      );
    }
    return { accepted: waiting.length };
  });
}
