"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { taskEvents, tasks } from "@/db/schema";
import { requireAdmin, requireMember } from "@/lib/auth";
import { pickGeneralTask } from "@/lib/general-tasks";
import { TASK_TYPES } from "@/lib/tasks/constants";

export type GeneralFormState = { error?: string; saved?: boolean };

const schema = z.object({
  title: z.string().trim().min(1, "Give the general task a title.").max(200, "Use at most 200 characters."),
  description: z.string().trim().max(1000, "Keep the description under 1,000 characters."),
  type: z.union([z.literal(""), z.enum(TASK_TYPES)]),
});

function refresh(id?: number) {
  revalidatePath("/tasks");
  if (id) revalidatePath(`/tasks/${id}`);
}

function parse(formData: FormData) {
  return schema.safeParse({
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    type: String(formData.get("type") ?? ""),
  });
}

/** Admins add a standing general task. */
export async function createGeneralTaskAction(_prev: GeneralFormState, formData: FormData): Promise<GeneralFormState> {
  const admin = await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const [task] = await db
    .insert(tasks)
    .values({ kind: "general", title: parsed.data.title, description: parsed.data.description || null, type: parsed.data.type || null, status: "todo", source: "app", createdById: admin.id })
    .returning({ id: tasks.id });
  await db.insert(taskEvents).values({ taskId: task.id, actorId: admin.id, source: "app", kind: "created", newValue: "Created as a general task" });
  refresh();
  return { saved: true };
}

/** Admins edit a general task; every changed field is kept in its history. */
export async function updateGeneralTaskAction(id: number, _prev: GeneralFormState, formData: FormData): Promise<GeneralFormState> {
  const admin = await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.kind, "general"), isNull(tasks.deletedAt))).limit(1);
  if (!task) return { error: "That general task no longer exists." };
  const next = { title: parsed.data.title, description: parsed.data.description || null, type: parsed.data.type || null };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((f) => task[f] !== next[f]);
  if (changed.length) {
    await db.transaction(async (tx) => {
      await tx.update(tasks).set({ ...next, updatedAt: new Date() }).where(eq(tasks.id, id));
      await tx.insert(taskEvents).values(changed.map((field) => ({ taskId: id, actorId: admin.id, source: "app" as const, kind: "updated" as const, field, oldValue: task[field], newValue: next[field] })));
    });
  }
  refresh(id);
  return { saved: true };
}

/** Admins remove a general task (kept with its history; members who picked it keep their pick). */
export async function removeGeneralTaskAction(id: number): Promise<void> {
  const admin = await requireAdmin();
  const [task] = await db
    .update(tasks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.kind, "general"), isNull(tasks.deletedAt)))
    .returning({ id: tasks.id });
  if (task) await db.insert(taskEvents).values({ taskId: id, actorId: admin.id, source: "app", kind: "deleted", newValue: "Removed the general task" });
  refresh(id);
  redirect("/tasks?tab=general");
}

/** One tap: the member takes a general task for a meeting they missed. */
export async function pickGeneralTaskAction(requestId: number, taskId: number): Promise<void> {
  const me = await requireMember();
  const result = await pickGeneralTask(me.id, requestId, taskId);
  refresh(taskId);
  redirect(result.ok ? "/tasks?tab=general&picked=1" : `/tasks?tab=general&error=${encodeURIComponent(result.error)}`);
}
