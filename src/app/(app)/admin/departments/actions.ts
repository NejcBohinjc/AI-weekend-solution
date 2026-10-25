"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
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

export type DepartmentMembersState = { error?: string; saved?: string } | null;

/**
 * Replaces a department's members with exactly the ticked ones. A department named like a tier
 * ("Core") only takes members of that tier, the same rule the member page and renaming enforce.
 */
export async function setDepartmentMembersAction(departmentId: number, _prev: DepartmentMembersState, formData: FormData): Promise<DepartmentMembersState> {
  await requireAdmin();
  const ids = [...new Set(formData.getAll("memberIds").map((v) => Number(v)))].filter((n) => Number.isInteger(n) && n > 0);
  const [department] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, departmentId)).limit(1);
  if (!department) return { error: "That department no longer exists." };

  const chosen = ids.length ? await db.select({ id: members.id, name: members.name, tier: members.tier }).from(members).where(inArray(members.id, ids)) : [];
  if (chosen.length !== ids.length) return { error: "Someone on that list no longer exists. Reload the page and try again." };
  const onlyFor = tierOfDepartment(department.name);
  if (onlyFor) {
    const wrong = chosen.find((m) => m.tier !== onlyFor);
    if (wrong) return { error: `${department.name} is only for the ${onlyFor} tier, but ${wrong.name} is not in it.` };
  }

  await db.transaction(async (tx) => {
    await tx.delete(memberDepartments).where(eq(memberDepartments.departmentId, departmentId));
    if (ids.length) await tx.insert(memberDepartments).values(ids.map((memberId) => ({ memberId, departmentId })));
  });
  refresh();
  return { saved: ids.length ? `Saved: ${ids.length} ${ids.length === 1 ? "member" : "members"} in ${department.name}.` : `Saved: ${department.name} has no members now.` };
}
