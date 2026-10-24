"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { members, taskEvents, tasks, type Task } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { STATUS_LABELS, TASK_STATUSES, type EditableField } from "@/lib/tasks/constants";
import { readTasksSheet, SheetConfigError } from "@/lib/tasks/google-sheets";
import { normalizeType } from "@/lib/tasks/sheet-mapping";
import { recordFailedSync, syncTasksFromSheet, type SyncReport } from "@/lib/tasks/sheet-sync";

export async function syncFromSheetAction(_prev: SyncReport | null): Promise<SyncReport> {
  const admin = await requireAdmin();
  try {
    const data = await readTasksSheet();
    return await syncTasksFromSheet(data, { actorId: admin.id });
  } catch (err) {
    // Log only the message: Google client errors carry request headers, including the access token.
    const message =
      err instanceof SheetConfigError ? err.message : `Could not read the Google Sheet: ${(err as Error).message ?? "unknown error"}`;
    console.error("[task sync]", message);
    return recordFailedSync(message, admin.id);
  } finally {
    revalidatePath("/tasks");
  }
}

export type TaskEditState = { error?: string; saved?: boolean };

const editSchema = z.object({
  status: z.enum(TASK_STATUSES),
  assigneeId: z.string().regex(/^\d*$/),
  type: z.string().max(60),
  dueDate: z.union([z.literal(""), z.iso.date()]),
});

/** Admin edit. Every field the admin changes is locked, so later sheet syncs keep the admin's value. */
export async function updateTaskAction(taskId: number, _prev: TaskEditState, formData: FormData): Promise<TaskEditState> {
  const admin = await requireAdmin();
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the values and try again." };

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { error: "Task not found." };

  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members)).map((m) => [m.id, m.name]));
  const assigneeId = parsed.data.assigneeId ? Number(parsed.data.assigneeId) : null;
  if (assigneeId !== null && !names.has(assigneeId)) return { error: "That member does not exist." };

  const next: Pick<Task, EditableField> = {
    status: parsed.data.status,
    assigneeId,
    type: normalizeType(parsed.data.type),
    dueDate: parsed.data.dueDate || null,
  };
  const show = (field: EditableField, v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (field === "status") return STATUS_LABELS[v as Task["status"]];
    if (field === "assigneeId") return names.get(v as number) ?? null;
    return String(v);
  };

  const changed = (Object.keys(next) as EditableField[]).filter((f) => task[f] !== next[f]);
  if (!changed.length) return { saved: true };

  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        ...Object.fromEntries(changed.map((f) => [f, next[f]])),
        lockedFields: [...new Set([...task.lockedFields, ...changed])],
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
    await tx.insert(taskEvents).values(
      changed.map((field) => ({
        taskId,
        actorId: admin.id,
        source: "app" as const,
        kind: "updated" as const,
        field,
        oldValue: show(field, task[field]),
        newValue: show(field, next[field]),
      })),
    );
  });
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  return { saved: true };
}
