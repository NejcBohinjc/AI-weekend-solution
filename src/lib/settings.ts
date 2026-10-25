// Institute-wide switches (admin only). Key/value in app_settings, so a new switch is one key here.
// No "server-only" here on purpose: meeting-tasks-run.ts reaches this module, and its tests import it.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Newly created AI tasks count straight away, instead of waiting for their assignee to confirm. */
export const AUTO_CONFIRM_AI_TASKS = "auto_confirm_ai_tasks";

/** Reads one boolean switch. Missing row = off, so the app behaves as it did before the switch existed. */
export async function getFlag(key: string): Promise<boolean> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value === "true";
}

/** Writes one boolean switch and remembers who flipped it. */
export async function setFlag(key: string, on: boolean, memberId: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value: String(on), updatedById: memberId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(on), updatedById: memberId, updatedAt: new Date() } });
}
