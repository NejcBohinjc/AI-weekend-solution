import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { members, reminderSettings, tasks } from "@/db/schema";
import { DEFAULT_TASK_REMINDER_DAYS, TASK_PRIORITIES } from "./constants";

/** A member's deadline reminder choice (defaults when they never saved one). */
export async function taskReminderSettingsFor(memberId: number) {
  const [row] = await db
    .select({ enabled: reminderSettings.taskEmailEnabled, daysBefore: reminderSettings.taskDaysBefore })
    .from(reminderSettings)
    .where(eq(reminderSettings.memberId, memberId))
    .limit(1);
  return { enabled: row?.enabled ?? true, daysBefore: row?.daysBefore ?? DEFAULT_TASK_REMINDER_DAYS };
}

export function activeMembers() {
  return db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)).orderBy(asc(members.name));
}

/** Sort key, most pressing first: urgent, medium, low (the order of TASK_PRIORITIES). */
export const priorityOrder = sql`array_position(array[${sql.join(TASK_PRIORITIES.map((p) => sql`${p}`), sql`, `)}]::text[], ${tasks.priority})`;

/** "My tasks": assigned to me, or delegated to one of my departments and not taken by anyone yet. */
export function myTasksCondition(me: { id: number; departmentIds: number[] }): SQL {
  if (!me.departmentIds.length) return eq(tasks.assigneeId, me.id);
  return or(eq(tasks.assigneeId, me.id), and(isNull(tasks.assigneeId), inArray(tasks.departmentId, me.departmentIds)))!;
}
