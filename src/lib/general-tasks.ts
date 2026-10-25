// General tasks: standing tasks held by one member at a time (rules in lib/absence-rules.ts). A member
// picks one after missing a meeting, or an admin assigns it; marking it done frees it for the next person.
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { attendance, generalTaskRequests, meetings, members, taskEvents, tasks, type Task } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { needsGeneralTask } from "@/lib/meetings/absence";
import { notify } from "@/lib/notifications";

export const GENERAL_TAB_LINK = "/tasks?tab=general";

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE });

/**
 * After an admin records or changes a member's attendance (or decides a late notice): ask the member to
 * pick a general task if the absence calls for one, or cancel an earlier request that no longer applies.
 */
export async function followUpAbsence(memberId: number, meetingId: number, now = new Date()): Promise<"requested" | "cancelled" | "none"> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) return "none";
  const [row] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.meetingId, meetingId), eq(attendance.memberId, memberId)))
    .limit(1);
  const reason = row ? needsGeneralTask(row.state, row) : null;
  const [existing] = await db
    .select()
    .from(generalTaskRequests)
    .where(and(eq(generalTaskRequests.memberId, memberId), eq(generalTaskRequests.meetingId, meetingId)))
    .limit(1);

  if (!reason) {
    if (existing && !existing.pickedTaskId && !existing.cancelledAt) {
      await db.update(generalTaskRequests).set({ cancelledAt: new Date() }).where(eq(generalTaskRequests.id, existing.id));
      return "cancelled";
    }
    return "none";
  }
  if (existing && !existing.cancelledAt) return "none"; // already asked (or already picked)
  // Nobody "missed" a meeting that has not ended yet; sweepAbsenceFollowUps() asks once it has.
  if (meeting.endsAt > now) return "none";
  await db.transaction(async (tx) => {
    if (existing) await tx.update(generalTaskRequests).set({ cancelledAt: null, reason, createdAt: new Date() }).where(eq(generalTaskRequests.id, existing.id));
    else await tx.insert(generalTaskRequests).values({ memberId, meetingId, reason });
    await notify(
      memberId,
      { type: "missed_meeting", text: `You missed ${meeting.title} on ${fmtDate(meeting.startsAt)}. Pick a task from the general task list.`, link: GENERAL_TAB_LINK },
      tx,
    );
  });
  return "requested";
}

/** Every message pickGeneralTask can return (the page shows only these, never free text from a URL). */
export const PICK_ERRORS = [
  "Nothing to pick a task for.",
  "This is no longer needed: your attendance was changed.",
  "You already picked a task for this meeting.",
  "That general task no longer exists.",
  "Someone else is doing that task right now. Pick another one.",
] as const;
export type PickResult = { ok: true } | { ok: false; error: (typeof PICK_ERRORS)[number] };

/** The member picks a general task for one of their open requests (one tap). */
export async function pickGeneralTask(memberId: number, requestId: number, taskId: number): Promise<PickResult> {
  const [request] = await db
    .select({ r: generalTaskRequests, meetingTitle: meetings.title })
    .from(generalTaskRequests)
    .innerJoin(meetings, eq(generalTaskRequests.meetingId, meetings.id))
    .where(and(eq(generalTaskRequests.id, requestId), eq(generalTaskRequests.memberId, memberId)))
    .limit(1);
  if (!request) return { ok: false, error: "Nothing to pick a task for." };
  if (request.r.cancelledAt) return { ok: false, error: "This is no longer needed: your attendance was changed." };
  if (request.r.pickedTaskId) return { ok: false, error: "You already picked a task for this meeting." };
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.kind, "general"), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) return { ok: false, error: "That general task no longer exists." };
  if (task.assigneeId !== null && task.assigneeId !== memberId) return { ok: false, error: "Someone else is doing that task right now. Pick another one." };
  const [me] = await db.select({ name: members.name }).from(members).where(eq(members.id, memberId)).limit(1);
  let taken = false;
  await db.transaction(async (tx) => {
    // The task becomes the member's (only while it is free: one person at a time).
    const [mine] = await tx
      .update(tasks)
      .set({ assigneeId: memberId, updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), or(isNull(tasks.assigneeId), eq(tasks.assigneeId, memberId))))
      .returning({ id: tasks.id });
    if (!mine) {
      taken = true;
      return;
    }
    const [updated] = await tx
      .update(generalTaskRequests)
      .set({ pickedTaskId: task.id, pickedAt: new Date() })
      .where(and(eq(generalTaskRequests.id, requestId), isNull(generalTaskRequests.pickedTaskId)))
      .returning({ id: generalTaskRequests.id });
    if (!updated) return;
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorId: memberId,
      source: "app",
      kind: "picked",
      newValue: `${me?.name ?? "A member"} picked this after missing “${request.meetingTitle}”`,
    });
  });
  if (taken) return { ok: false, error: "Someone else is doing that task right now. Pick another one." };
  return { ok: true };
}

/**
 * The person doing a general task marks it done: it is not closed (general tasks are standing tasks)
 * but freed for the next person, back to "To do", and its history says who finished it. False if the
 * task is not a general task held by someone.
 */
export async function completeGeneralTask(task: Pick<Task, "id" | "kind" | "assigneeId" | "status">, actorId: number, now = new Date()): Promise<boolean> {
  if (task.kind !== "general" || task.assigneeId === null) return false;
  const holder = task.assigneeId;
  const [who] = await db.select({ name: members.name }).from(members).where(eq(members.id, holder)).limit(1);
  return db.transaction(async (tx) => {
    const [freed] = await tx
      .update(tasks)
      .set({ assigneeId: null, status: "todo", updatedAt: now })
      .where(and(eq(tasks.id, task.id), eq(tasks.assigneeId, holder)))
      .returning({ id: tasks.id });
    if (!freed) return false;
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorId,
      source: "app",
      kind: "completed",
      newValue: `${who?.name ?? "A member"} finished it; it is free for the next person`,
    });
    return true;
  });
}

/** Admins give a general task to one member, move it to another, or free it (memberId null). */
export async function assignGeneralTask(taskId: number, memberId: number | null, adminId: number): Promise<"saved" | "unchanged" | "gone"> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.kind, "general"), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) return "gone";
  if (task.assigneeId === memberId) return "unchanged";
  const ids = [task.assigneeId, memberId].filter((id): id is number => id !== null);
  const names = new Map((ids.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids)) : []).map((m) => [m.id, m.name]));
  await db.transaction(async (tx) => {
    await tx.update(tasks).set({ assigneeId: memberId, updatedAt: new Date() }).where(eq(tasks.id, taskId));
    await tx.insert(taskEvents).values({
      taskId,
      actorId: adminId,
      source: "app",
      kind: "updated",
      field: "assigneeId",
      oldValue: task.assigneeId ? (names.get(task.assigneeId) ?? null) : null,
      newValue: memberId ? (names.get(memberId) ?? null) : null,
    });
  });
  return "saved";
}

const SWEEP_DAYS = 14;

/**
 * Asks for general tasks for absences decided before the meeting (e.g. a late notice not accepted)
 * once the meeting has ended. Only admin-recorded or admin-decided rows of meetings that ended in the
 * last SWEEP_DAYS days, so imported history never floods anyone with notifications.
 */
export async function sweepAbsenceFollowUps(now = new Date()): Promise<number> {
  const rows = await db
    .select({ memberId: attendance.memberId, meetingId: attendance.meetingId })
    .from(attendance)
    .innerJoin(meetings, eq(attendance.meetingId, meetings.id))
    .leftJoin(generalTaskRequests, and(eq(generalTaskRequests.memberId, attendance.memberId), eq(generalTaskRequests.meetingId, attendance.meetingId)))
    .where(
      and(
        isNull(generalTaskRequests.id),
        lte(meetings.endsAt, now),
        gt(meetings.endsAt, new Date(now.getTime() - SWEEP_DAYS * 86_400_000)),
        or(eq(attendance.source, "admin"), isNotNull(attendance.lateDecision)),
        or(eq(attendance.state, "unexcused"), and(eq(attendance.state, "excused"), eq(attendance.lateNotice, true))),
      ),
    );
  let asked = 0;
  for (const r of rows) if ((await followUpAbsence(r.memberId, r.meetingId, now)) === "requested") asked++;
  return asked;
}

// At most one sweep per server process every few minutes (page loads call it in the background).
let lastSweep = 0;
export function sweepAbsenceFollowUpsQuietly(): void {
  if (Date.now() - lastSweep < 5 * 60_000) return;
  lastSweep = Date.now();
  sweepAbsenceFollowUps().catch((err) => console.error("[general tasks]", (err as Error).message));
}
