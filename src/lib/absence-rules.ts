// Absence notices and general tasks: every rule from the member feedback (Taj) in one file, so they are
// easy to change. Shared by the schema (drizzle-kit) and the app, so no imports with the @/ alias here.
//
// ASSUMPTION: what a "general task" is comes from a short note: standing tasks anyone can help with
// (research, reviewing documents, supporting an event), which a member picks after missing a meeting.
// If that reading is wrong, change the rules below.

/** An excuse sent at least this long before the meeting starts counts as a normal excused absence. */
export const ABSENCE_NOTICE_HOURS = 72;

/**
 * Which absences recorded by an admin ask the member to pick a general task (notification + request).
 * unexcused: recorded as unexcused. lateNoticeRejected: an admin decided a late notice does not count
 * as excused. lateNoticePending: a late notice an admin has not decided on yet. excused: a normal excuse.
 */
export const GENERAL_TASK_AFTER = {
  unexcused: true,
  lateNoticeRejected: true,
  lateNoticePending: false,
  excused: false,
} as const;

/**
 * General tasks are standing tasks: their status is never "done" (app, server and sheet sync). One member
 * holds one at a time; when they mark it done it is unassigned and stays "To do" for the next person.
 */
export const GENERAL_TASKS_CAN_BE_DONE = false;

/** Shown in the app next to general tasks, so the assumption stays visible. */
export const GENERAL_TASK_ASSUMPTION =
  "General tasks are standing tasks. One person does a task at a time: after missing a meeting a member picks one, or an admin assigns it. When they mark it done, it goes back on the list for the next person. (Our reading of the member feedback; admins can ask for the rules to change.)";

export const TASK_KINDS = ["project", "general"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const LATE_DECISIONS = ["accepted", "rejected"] as const;
export type LateDecision = (typeof LATE_DECISIONS)[number];
