// Changing a task from the app: one path for the edit form, the tick and the untick, so the
// completion time, the status before "done" and the history are always kept the same way.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, taskEvents, tasks, type Task } from "@/db/schema";
import { STATUS_LABELS, type TaskStatus } from "./constants";
import { completionFields, isReopen, reopenStatus } from "./done";
import { GENERAL_TASKS_CAN_BE_DONE } from "@/lib/absence-rules";

export type TaskField = "title" | "status" | "assigneeId" | "type" | "dueDate";

/** A change the task rules do not allow (e.g. marking a general task as done). */
export class TaskRuleError extends Error {}

/** General tasks are standing tasks: never done (lib/absence-rules.ts). */
export function assertMayChangeStatus(task: Pick<Task, "kind">, next: TaskStatus | undefined): void {
  if (task.kind === "general" && next === "done" && !GENERAL_TASKS_CAN_BE_DONE) throw new TaskRuleError("General tasks can't be marked as done.");
}

/** Saves the changed fields, one history row each ("reopened" for done -> not done). False if nothing changed. */
export async function applyTaskChanges(task: Task, next: Partial<Pick<Task, TaskField>>, actorId: number, now = new Date()): Promise<boolean> {
  assertMayChangeStatus(task, next.status);
  const changed = (Object.keys(next) as TaskField[]).filter((f) => task[f] !== next[f]);
  if (!changed.length) return false;
  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members)).map((m) => [m.id, m.name]));
  const show = (f: TaskField, v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (f === "status") return STATUS_LABELS[v as TaskStatus];
    if (f === "assigneeId") return names.get(v as number) ?? null;
    return String(v);
  };
  const completion = next.status ? completionFields(task, next.status, now) : null;
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ ...Object.fromEntries(changed.map((f) => [f, next[f]])), ...completion, updatedAt: now })
      .where(eq(tasks.id, task.id));
    await tx.insert(taskEvents).values(
      changed.map((field) => ({
        taskId: task.id,
        actorId,
        source: "app" as const,
        kind: field === "status" && isReopen(task.status, next.status!) ? ("reopened" as const) : ("updated" as const),
        field,
        oldValue: show(field, task[field]),
        newValue: show(field, next[field]),
      })),
    );
  });
  return true;
}

/** Was the task ever in progress or in verification (from its history)? Decides where an untick goes when unknown. */
async function everStarted(taskId: number): Promise<boolean> {
  const rows = await db
    .select({ id: taskEvents.id })
    .from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.field, "status"), inArray(taskEvents.newValue, [STATUS_LABELS.in_progress, STATUS_LABELS.verification])))
    .limit(1);
  return rows.length > 0;
}

/**
 * Ticks (done = true) or unticks a task. Unticking puts back the status it had before "done".
 * Returns the new status, or null if it was already in that state.
 */
export async function setTaskDone(task: Task, done: boolean, actorId: number, now = new Date()): Promise<TaskStatus | null> {
  if (done) assertMayChangeStatus(task, "done");
  if (done === (task.status === "done")) return null;
  const status = done ? "done" : reopenStatus(task.statusBeforeDone, await everStarted(task.id));
  await applyTaskChanges(task, { status }, actorId, now);
  return status;
}
