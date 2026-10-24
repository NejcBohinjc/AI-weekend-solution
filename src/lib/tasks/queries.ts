import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { members, tasks } from "@/db/schema";

export function activeMembers() {
  return db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)).orderBy(asc(members.name));
}

/** "My tasks": assigned to me, or delegated to one of my departments and not taken by anyone yet. */
export function myTasksCondition(me: { id: number; departmentIds: number[] }): SQL {
  if (!me.departmentIds.length) return eq(tasks.assigneeId, me.id);
  return or(eq(tasks.assigneeId, me.id), and(isNull(tasks.assigneeId), inArray(tasks.departmentId, me.departmentIds)))!;
}
