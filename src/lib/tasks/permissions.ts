import type { SessionMember } from "@/lib/auth";

type Viewer = Pick<SessionMember, "id" | "isAdmin"> & { departmentIds?: number[] };
type TaskRef = { assigneeId: number | null; createdById: number | null; triggeredById?: number | null; departmentId?: number | null };

/** The task is delegated to one of the viewer's departments (and not yet taken by one person). */
export function isMyDepartmentTask(me: Viewer, task: TaskRef): boolean {
  return task.assigneeId === null && task.departmentId != null && (me.departmentIds ?? []).includes(task.departmentId);
}

/**
 * Admins edit every task; members edit tasks assigned to them, delegated to one of their departments,
 * or created by them (for AI tasks: who ran the AI).
 */
export function canEditTask(me: Viewer, task: TaskRef): boolean {
  return (
    me.isAdmin ||
    task.assigneeId === me.id ||
    isMyDepartmentTask(me, task) ||
    task.createdById === me.id ||
    (task.triggeredById ?? null) === me.id
  );
}

/** A department task can be taken by anyone in that department: it becomes theirs. */
export function canTakeTask(me: Viewer, task: TaskRef & { status: string }): boolean {
  return task.status !== "done" && isMyDepartmentTask(me, task);
}

/** An unconfirmed AI task is confirmed by its assignee (or an admin). */
export function canConfirmAiTask(me: Pick<SessionMember, "id" | "isAdmin">, task: { createdByAi: boolean; aiConfirmedAt: Date | null; assigneeId: number | null }): boolean {
  return task.createdByAi && !task.aiConfirmedAt && (me.isAdmin || task.assigneeId === me.id);
}

/** AI tasks can be deleted in one click by whoever may edit them. */
export function canDeleteAiTask(me: Viewer, task: TaskRef & { createdByAi: boolean }): boolean {
  return task.createdByAi && canEditTask(me, task);
}
