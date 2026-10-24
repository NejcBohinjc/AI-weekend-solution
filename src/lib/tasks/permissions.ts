import type { SessionMember } from "@/lib/auth";

type TaskRef = { assigneeId: number | null; createdById: number | null; triggeredById?: number | null };

/** Admins edit every task; members edit tasks assigned to them or created by them (for AI tasks: who ran the AI). */
export function canEditTask(me: Pick<SessionMember, "id" | "isAdmin">, task: TaskRef): boolean {
  return me.isAdmin || task.assigneeId === me.id || task.createdById === me.id || (task.triggeredById ?? null) === me.id;
}

/** An unconfirmed AI task is confirmed by its assignee (or an admin). */
export function canConfirmAiTask(me: Pick<SessionMember, "id" | "isAdmin">, task: { createdByAi: boolean; aiConfirmedAt: Date | null; assigneeId: number | null }): boolean {
  return task.createdByAi && !task.aiConfirmedAt && (me.isAdmin || task.assigneeId === me.id);
}

/** AI tasks can be deleted in one click by whoever may edit them. */
export function canDeleteAiTask(me: Pick<SessionMember, "id" | "isAdmin">, task: TaskRef & { createdByAi: boolean }): boolean {
  return task.createdByAi && canEditTask(me, task);
}
