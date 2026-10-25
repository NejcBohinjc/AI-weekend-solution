// Absence notices (excuses) and when a missed meeting asks for a general task. Pure, unit-tested
// (absence.test.ts). The numbers live in lib/absence-rules.ts.
import { TIMEZONE } from "@/lib/app";
import { ABSENCE_NOTICE_HOURS, GENERAL_TASK_AFTER, type LateDecision } from "@/lib/absence-rules";
import type { AttendanceState } from "./constants";

const HOUR = 3_600_000;

/** The last moment an excuse counts as on time: ABSENCE_NOTICE_HOURS before the start (real hours). */
export function noticeDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - ABSENCE_NOTICE_HOURS * HOUR);
}

/** Sent after the deadline (exactly at the deadline is still on time). */
export function isLateNotice(sentAt: Date, startsAt: Date): boolean {
  return sentAt.getTime() > noticeDeadline(startsAt).getTime();
}

/** "2 days 4 h", "3 h 20 min", "12 min" */
export function formatRemaining(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const minutes = min % 60;
  if (days) return `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} h` : ""}`;
  if (hours) return `${hours} h${minutes ? ` ${minutes} min` : ""}`;
  return `${minutes} min`;
}

/** The deadline as Ljubljana time, e.g. "Fri, 23 Oct, 18:00". */
export function formatDeadline(deadline: Date): string {
  return deadline.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
}

/** What the excuse form says about the 72-hour rule right now. */
export function noticeHint(startsAt: Date, now: Date): { late: boolean; text: string } {
  const deadline = noticeDeadline(startsAt);
  const rule = `Excuses sent at least ${ABSENCE_NOTICE_HOURS} h before the start count as excused.`;
  if (now.getTime() <= deadline.getTime()) {
    return { late: false, text: `${rule} Deadline: ${formatDeadline(deadline)} (in ${formatRemaining(deadline.getTime() - now.getTime())}).` };
  }
  return {
    late: true,
    text: `${rule} The deadline (${formatDeadline(deadline)}) passed ${formatRemaining(now.getTime() - deadline.getTime())} ago, so this will be a late notice: an admin decides whether it counts as excused, until then it counts as unexcused.`,
  };
}

export type LateInfo = { lateNotice: boolean; lateDecision: LateDecision | null };

/** A late notice counts as unexcused until an admin accepts it. */
export function countsAsUnexcused(state: AttendanceState, late: LateInfo | null | undefined): boolean {
  return state === "unexcused" || (state === "excused" && !!late?.lateNotice && late.lateDecision !== "accepted");
}

/** Whether an absence recorded this way asks the member to pick a general task (GENERAL_TASK_AFTER). */
export function needsGeneralTask(state: AttendanceState, late: LateInfo | null | undefined): string | null {
  if (state === "unexcused") return GENERAL_TASK_AFTER.unexcused ? "unexcused" : null;
  if (state !== "excused") return null;
  if (late?.lateNotice) {
    if (late.lateDecision === "rejected") return GENERAL_TASK_AFTER.lateNoticeRejected ? "late notice not accepted" : null;
    if (late.lateDecision === null) return GENERAL_TASK_AFTER.lateNoticePending ? "late notice" : null;
    return GENERAL_TASK_AFTER.excused ? "excused" : null;
  }
  return GENERAL_TASK_AFTER.excused ? "excused" : null;
}
