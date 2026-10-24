// General tasks: standing tasks members pick after missing a meeting (rules in lib/absence-rules.ts).
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { attendance, generalTaskRequests, meetings, members, taskEvents, tasks } from "@/db/schema";
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
  const [me] = await db.select({ name: members.name }).from(members).where(eq(members.id, memberId)).limit(1);
  await db.transaction(async (tx) => {
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
  return { ok: true };
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
