"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { departments, members, projects, reminderSettings, taskEvents, tasks, type Task } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { TASK_PRIORITIES, TASK_REMINDER_OPTIONS, TASK_STATUSES, TASK_TYPES, type TaskStatus } from "@/lib/tasks/constants";
import { applyTaskChanges, setTaskDone, TaskRuleError, type TaskField } from "@/lib/tasks/changes";
import { parseOwner } from "@/lib/tasks/owner";
import { canConfirmAiTask, canDeleteAiTask, canEditTask, canTakeTask } from "@/lib/tasks/permissions";
import { runTasksSync } from "@/lib/tasks/sheet-sync";

type Field = TaskField;

/** owner: "m:<member id>", "d:<department id>" or "" (see lib/tasks/owner.ts). */
export type TaskFormValues = { title: string; status: string; priority: string; owner: string; projectId: string; type: string; dueDate: string };
const FORM_FIELDS = ["title", "status", "priority", "owner", "projectId", "type", "dueDate"] as const;
export type TaskFormState = { error?: string; saved?: boolean; values?: TaskFormValues };

const schema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200, "Use at most 200 characters."),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES, "Pick a priority from the list."),
  owner: z.string().max(20),
  projectId: z.string().regex(/^\d*$/, "Pick a project from the list."),
  type: z.string().max(60),
  dueDate: z.union([z.literal(""), z.iso.date()]),
});

function refresh(taskId?: number) {
  revalidatePath("/tasks");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard");
  revalidatePath("/projects");
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
  const values = Object.fromEntries(FORM_FIELDS.map((f) => [f, String(formData.get(f) ?? "")])) as TaskFormValues;
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the values.", values };
  const type = parsed.data.type.trim() || null;
  if (type !== null && !(TASK_TYPES as readonly string[]).includes(type) && type !== currentType) {
    return { error: "Pick a type from the list.", values };
  }
  const owner = parseOwner(parsed.data.owner);
  if (!owner) return { error: "Pick a person or a department.", values };
  if (owner.assigneeId !== null) {
    const [m] = await db.select({ active: members.active }).from(members).where(eq(members.id, owner.assigneeId)).limit(1);
    if (!m?.active) return { error: "Pick an active member.", values };
  }
  if (owner.departmentId !== null) {
    const [d] = await db.select({ id: departments.id }).from(departments).where(eq(departments.id, owner.departmentId)).limit(1);
    if (!d) return { error: "That department no longer exists.", values };
  }
  const projectId = parsed.data.projectId ? Number(parsed.data.projectId) : null;
  if (projectId !== null) {
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!p) return { error: "That project no longer exists.", values };
  }
  return {
    data: {
      title: parsed.data.title.replace(/\s+/g, " "),
      status: parsed.data.status,
      priority: parsed.data.priority,
      ...owner,
      projectId,
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
  try {
    if (await applyTaskChanges(task, result.data, me.id)) pushToSheetLater(me.id);
  } catch (err) {
    if (err instanceof TaskRuleError) return { error: err.message, values: undefined };
    throw err;
  }
  refresh(taskId);
  return { saved: true };
}

/** Someone in the department takes a task delegated to it: it becomes theirs alone. */
export async function takeTaskAction(taskId: number): Promise<void> {
  const { me, task } = await loadTask(taskId);
  if (task && canTakeTask(me, task) && (await applyTaskChanges(task, { assigneeId: me.id, departmentId: null }, me.id))) pushToSheetLater(me.id);
  refresh(taskId);
}

export type DoneResult = { ok: boolean; error?: string; title?: string; status?: TaskStatus };

/**
 * Ticks or unticks a task (list, task page, dashboard). Same rule as editing: assignee, creator or
 * admin. Unticking puts the task back to the status it had before.
 */
export async function setTaskDoneAction(taskId: number, done: boolean): Promise<DoneResult> {
  const { me, task } = await loadEditable(taskId);
  if (!task) return { ok: false, error: "You can't change this task." };
  let status: TaskStatus | null;
  try {
    status = await setTaskDone(task, done, me.id);
  } catch (err) {
    if (err instanceof TaskRuleError) return { ok: false, error: err.message };
    throw err;
  }
  if (status) pushToSheetLater(me.id);
  refresh(taskId);
  return { ok: true, title: task.title, status: status ?? task.status };
}

export type TaskReminderSettingsState = { saved?: boolean };

/** A member's deadline reminders: on/off and which days before the due date. */
export async function saveTaskReminderSettingsAction(_prev: TaskReminderSettingsState, formData: FormData): Promise<TaskReminderSettingsState> {
  const me = await requireMember();
  const allowed = new Set(TASK_REMINDER_OPTIONS.map((o) => o.days));
  const taskDaysBefore = [...new Set(formData.getAll("daysBefore").map(Number))].filter((d) => allowed.has(d)).sort((a, b) => b - a);
  const taskEmailEnabled = formData.get("enabled") === "on";
  await db
    .insert(reminderSettings)
    .values({ memberId: me.id, taskEmailEnabled, taskDaysBefore })
    .onConflictDoUpdate({ target: reminderSettings.memberId, set: { taskEmailEnabled, taskDaysBefore, updatedAt: new Date() } });
  revalidatePath("/tasks");
  return { saved: true };
}

export type SyncNowState ={ ran?: boolean; ok?: boolean; summary?: string; error?: string } | null;

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
