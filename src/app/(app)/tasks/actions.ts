"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { members, taskEvents, tasks, type Task } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { STATUS_LABELS, TASK_STATUSES, TASK_TYPES } from "@/lib/tasks/constants";
import { canConfirmAiTask, canDeleteAiTask, canEditTask } from "@/lib/tasks/permissions";
import { runTasksSync } from "@/lib/tasks/sheet-sync";

type Field = "title" | "status" | "assigneeId" | "type" | "dueDate";
const FIELDS: Field[] = ["title", "status", "assigneeId", "type", "dueDate"];

export type TaskFormValues = { title: string; status: string; assigneeId: string; type: string; dueDate: string };
export type TaskFormState = { error?: string; saved?: boolean; values?: TaskFormValues };

const schema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200, "Use at most 200 characters."),
  status: z.enum(TASK_STATUSES),
  assigneeId: z.string().regex(/^\d*$/),
  type: z.string().max(60),
  dueDate: z.union([z.literal(""), z.iso.date()]),
});

function refresh(taskId?: number) {
  revalidatePath("/tasks");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard");
}

/** Sends the change to the sheet right after the response (skipped if a sync is already running). */
function pushToSheetLater(actorId: number) {
  after(async () => {
    try {
      await runTasksSync({ actorId, minIntervalSeconds: 0 });
    } catch (err) {
      console.error("[tasks sheet]", (err as Error).message);
    }
  });
}

/** `currentType`: the task's type now, accepted even if it is not in TASK_TYPES (typed in the sheet). */
async function parse(formData: FormData, currentType: string | null = null): Promise<{ data: Pick<Task, Field> } | { error: string; values: TaskFormValues }> {
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")])) as TaskFormValues;
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the values.", values };
  const type = parsed.data.type.trim() || null;
  if (type !== null && !(TASK_TYPES as readonly string[]).includes(type) && type !== currentType) {
    return { error: "Pick a type from the list.", values };
  }
  const assigneeId = parsed.data.assigneeId ? Number(parsed.data.assigneeId) : null;
  if (assigneeId !== null) {
    const [m] = await db.select({ active: members.active }).from(members).where(eq(members.id, assigneeId)).limit(1);
    if (!m?.active) return { error: "Pick an active member.", values };
  }
  return {
    data: {
      title: parsed.data.title.replace(/\s+/g, " "),
      status: parsed.data.status,
      assigneeId,
      type,
      dueDate: parsed.data.dueDate || null,
    },
  };
}

export async function createTaskAction(_prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const me = await requireMember();
  const result = await parse(formData);
  if ("error" in result) return result;
  const [task] = await db
    .insert(tasks)
    .values({ ...result.data, source: "app", createdById: me.id })
    .returning({ id: tasks.id });
  await db.insert(taskEvents).values({ taskId: task.id, actorId: me.id, source: "app", kind: "created", newValue: "Created in the app" });
  pushToSheetLater(me.id);
  refresh();
  redirect(`/tasks/${task.id}?created=1`);
}

/** Saves the changed fields, one history row each. Returns false if nothing changed. */
async function applyChanges(task: Task, next: Partial<Pick<Task, Field>>, actorId: number): Promise<boolean> {
  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members)).map((m) => [m.id, m.name]));
  const show = (f: Field, v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (f === "status") return STATUS_LABELS[v as Task["status"]];
    if (f === "assigneeId") return names.get(v as number) ?? null;
    return String(v);
  };
  const changed = (Object.keys(next) as Field[]).filter((f) => task[f] !== next[f]);
  if (!changed.length) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ ...Object.fromEntries(changed.map((f) => [f, next[f]])), updatedAt: new Date() })
      .where(eq(tasks.id, task.id));
    await tx.insert(taskEvents).values(
      changed.map((field) => ({
        taskId: task.id,
        actorId,
        source: "app" as const,
        kind: "updated" as const,
        field,
        oldValue: show(field, task[field]),
        newValue: show(field, next[field]),
      })),
    );
  });
  return true;
}

async function loadTask(taskId: number) {
  const me = await requireMember();
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt))).limit(1);
  return { me, task: task ?? null };
}

async function loadEditable(taskId: number) {
  const { me, task } = await loadTask(taskId);
  return { me, task: task && canEditTask(me, task) ? task : null };
}

/** The assignee accepts a task the AI created ("AI, confirmed"). */
export async function confirmAiTaskAction(taskId: number): Promise<void> {
  const { me, task } = await loadTask(taskId);
  if (task && canConfirmAiTask(me, task)) {
    await db.transaction(async (tx) => {
      await tx.update(tasks).set({ aiConfirmedAt: new Date() }).where(eq(tasks.id, task.id));
      await tx.insert(taskEvents).values({ taskId: task.id, actorId: me.id, source: "app", kind: "confirmed", newValue: "Confirmed the AI-created task" });
    });
  }
  refresh(taskId);
}

/** Deletes an AI-created task. It is not recreated by a rerun on the same notes, and its sheet row is removed. */
export async function deleteAiTaskAction(taskId: number): Promise<void> {
  const { me, task } = await loadTask(taskId);
  if (task && canDeleteAiTask(me, task)) {
    await db.transaction(async (tx) => {
      await tx.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, task.id));
      await tx.insert(taskEvents).values({ taskId: task.id, actorId: me.id, source: "app", kind: "deleted", newValue: "Deleted the AI-created task" });
    });
    pushToSheetLater(me.id);
    refresh(taskId);
    redirect("/tasks?deleted=1");
  }
  refresh(taskId);
}

/** Edit, reschedule or hand over (change the assignee). */
export async function updateTaskAction(taskId: number, _prev: TaskFormState, formData: FormData): Promise<TaskFormState> {
  const { me, task } = await loadEditable(taskId);
  if (!task) return { error: "You can't edit this task." };
  const result = await parse(formData, task.type);
  if ("error" in result) return result;
  if (await applyChanges(task, result.data, me.id)) pushToSheetLater(me.id);
  refresh(taskId);
  return { saved: true };
}

/** One-tap finish from the list or the task page. */
export async function finishTaskAction(taskId: number): Promise<void> {
  const { me, task } = await loadEditable(taskId);
  if (task && (await applyChanges(task, { status: "done" }, me.id))) pushToSheetLater(me.id);
  refresh(taskId);
}

export type SyncNowState = { ran?: boolean; ok?: boolean; summary?: string; error?: string } | null;

/** "Sync now", for every member. Admins get the error text; the full report is on the tasks page. */
export async function syncNowAction(_prev: SyncNowState): Promise<SyncNowState> {
  const me = await requireMember();
  const { ran, report } = await runTasksSync({ actorId: me.id, force: true });
  refresh();
  if (!ran || !report) return { ran: false };
  if (!report.ok) return { ran: true, ok: false, error: report.error };
  const fromSheet = report.created.length + report.updated.length;
  const toSheet = report.appended.length + report.exported.length;
  return { ran: true, ok: true, summary: `${fromSheet} from the sheet, ${toSheet} to the sheet` };
}
