// Reads for departments (see the departments table in db/schema.ts).
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, members, tasks } from "@/db/schema";

export function departmentList() {
  return db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name));
}

/** Every department with its active members and open (not done, not deleted) tasks delegated to it. */
export async function departmentsWithCounts() {
  const [list, memberCounts, taskCounts] = await Promise.all([
    departmentList(),
    db
      .select({ id: members.departmentId, n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(eq(members.active, true), isNotNull(members.departmentId)))
      .groupBy(members.departmentId),
    db
      .select({ id: tasks.departmentId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(isNotNull(tasks.departmentId), ne(tasks.status, "done"), isNull(tasks.deletedAt)))
      .groupBy(tasks.departmentId),
  ]);
  const membersOf = new Map(memberCounts.map((c) => [c.id, c.n]));
  const tasksOf = new Map(taskCounts.map((c) => [c.id, c.n]));
  return list.map((d) => ({ ...d, members: membersOf.get(d.id) ?? 0, openTasks: tasksOf.get(d.id) ?? 0 }));
}
