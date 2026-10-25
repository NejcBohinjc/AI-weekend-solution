"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { departments, memberDepartments, members, tasks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { tierOfDepartment } from "@/lib/department-rules";

export type DepartmentFormState = { error?: string; saved?: boolean };

const nameSchema = z.string().trim().min(1, "Enter a name.").max(40, "Use at most 40 characters.");

function refresh() {
  revalidatePath("/admin/departments");
  revalidatePath("/admin/members", "layout");
  revalidatePath("/tasks", "layout");
}

/** A name is taken if another department has it, ignoring case ("tech" and "Tech" are the same). */
async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const same = sql`lower(${departments.name}) = lower(${name})`;
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(exceptId ? and(same, ne(departments.id, exceptId)) : same)
    .limit(1);
  return !!row;
}

export async function createDepartmentAction(_prev: DepartmentFormState, formData: FormData): Promise<DepartmentFormState> {
  await requireAdmin();
  const name = nameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { error: name.error.issues[0].message };
  if (await nameTaken(name.data)) return { error: "There is already a department with this name." };
  await db.insert(departments).values({ name: name.data });
  refresh();
  return { saved: true };
}

export async function renameDepartmentAction(id: number, _prev: DepartmentFormState, formData: FormData): Promise<DepartmentFormState> {
  await requireAdmin();
  const name = nameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { error: name.error.issues[0].message };
  if (await nameTaken(name.data, id)) return { error: "There is already a department with this name." };
  // A tier's name reserves the department for that tier, so its members must all be of it.
  const onlyFor = tierOfDepartment(name.data);
  if (onlyFor) {
    const [other] = await db
      .select({ name: members.name })
      .from(memberDepartments)
      .innerJoin(members, eq(memberDepartments.memberId, members.id))
      .where(and(eq(memberDepartments.departmentId, id), ne(members.tier, onlyFor)))
      .limit(1);
    if (other) return { error: `${name.data} would be only for the ${onlyFor} tier, but ${other.name} is not in it.` };
  }
  await db.update(departments).set({ name: name.data }).where(eq(departments.id, id));
  refresh();
  return { saved: true };
}

/** Only an empty department can be deleted: no members and no open tasks delegated to it. */
export async function deleteDepartmentAction(id: number): Promise<void> {
  await requireAdmin();
  const [[m], [t]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(memberDepartments).where(eq(memberDepartments.departmentId, id)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.departmentId, id), ne(tasks.status, "done"), sql`${tasks.deletedAt} is null`)),
  ]);
  if (m.n === 0 && t.n === 0) await db.delete(departments).where(eq(departments.id, id));
  refresh();
}
