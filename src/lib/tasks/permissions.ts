import type { SessionMember } from "@/lib/auth";

/** Admins edit every task; members edit tasks assigned to them or created by them. */
export function canEditTask(me: Pick<SessionMember, "id" | "isAdmin">, task: { assigneeId: number | null; createdById: number | null }): boolean {
  return me.isAdmin || task.assigneeId === me.id || task.createdById === me.id;
}
