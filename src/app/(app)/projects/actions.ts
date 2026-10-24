"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { projects, tasks } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export type ProjectFormState = { error?: string; saved?: boolean };

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80, "Use at most 80 characters."),
  description: z.string().trim().max(300, "Keep the description under 300 characters."),
});

function read(formData: FormData) {
  return schema.safeParse({ name: formData.get("name") ?? "", description: formData.get("description") ?? "" });
}

function refresh() {
  revalidatePath("/projects");
  revalidatePath("/tasks", "layout");
}

/** "Grants" and "grants" are the same name. */
async function nameTaken(name: string, exceptId?: number): Promise<boolean> {
  const same = sql`lower(${projects.name}) = lower(${name})`;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(exceptId ? and(same, ne(projects.id, exceptId)) : same)
    .limit(1);
  return !!row;
}

/** Adds a project in one step and opens it, ready for its first task. */
export async function createProjectAction(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  await requireAdmin();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (await nameTaken(parsed.data.name)) return { error: "There is already a project with this name." };
  const [project] = await db
    .insert(projects)
    .values({ name: parsed.data.name, description: parsed.data.description || null })
    .returning({ id: projects.id });
  refresh();
  redirect(`/projects?open=${project.id}`);
}

export async function updateProjectAction(id: number, _prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  await requireAdmin();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (await nameTaken(parsed.data.name, id)) return { error: "There is already a project with this name." };
  await db
    .update(projects)
    .set({ name: parsed.data.name, description: parsed.data.description || null, updatedAt: new Date() })
    .where(eq(projects.id, id));
  refresh();
  return { saved: true };
}

/** Only a project without tasks can be deleted, so no task silently loses its project. */
export async function deleteProjectAction(id: number): Promise<void> {
  await requireAdmin();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.projectId, id), isNull(tasks.deletedAt)));
  if (n === 0) await db.delete(projects).where(eq(projects.id, id));
  refresh();
}
