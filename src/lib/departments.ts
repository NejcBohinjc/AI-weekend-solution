// Reads for departments (see departments and member_departments in db/schema.ts).
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, memberDepartments, members, tasks } from "@/db/schema";

export function departmentList() {
  return db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name));
}

/** The ids of a member's departments. */
export async function departmentIdsOf(memberId: number): Promise<number[]> {
  const rows = await db.select({ id: memberDepartments.departmentId }).from(memberDepartments).where(eq(memberDepartments.memberId, memberId));
  return rows.map((r) => r.id);
}

/** Every member's departments, as member id -> department names (sorted). */
export async function departmentNamesByMember(): Promise<Map<number, string[]>> {
  const rows = await db
    .select({ memberId: memberDepartments.memberId, name: departments.name })
    .from(memberDepartments)
    .innerJoin(departments, eq(memberDepartments.departmentId, departments.id))
    .orderBy(asc(departments.name));
  const byMember = new Map<number, string[]>();
  for (const r of rows) byMember.set(r.memberId, [...(byMember.get(r.memberId) ?? []), r.name]);
  return byMember;
}

/** Every department with its active members and open (not done, not deleted) tasks delegated to it. */
export async function departmentsWithCounts() {
  const [list, people, taskCounts] = await Promise.all([
    departmentList(),
    db
      .select({ departmentId: memberDepartments.departmentId, id: members.id, name: members.name })
      .from(memberDepartments)
      .innerJoin(members, and(eq(memberDepartments.memberId, members.id), eq(members.active, true)))
      .orderBy(asc(members.name)),
    db
      .select({ id: tasks.departmentId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(isNotNull(tasks.departmentId), ne(tasks.status, "done"), isNull(tasks.deletedAt)))
      .groupBy(tasks.departmentId),
  ]);
  const tasksOf = new Map(taskCounts.map((c) => [c.id, c.n]));
  return list.map((d) => {
    const inIt = people.filter((p) => p.departmentId === d.id).map((p) => ({ id: p.id, name: p.name }));
    return { ...d, members: inIt, openTasks: tasksOf.get(d.id) ?? 0 };
  });
}
