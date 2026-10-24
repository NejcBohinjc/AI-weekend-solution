// Shared by the schema (drizzle-kit) and the app, so no imports with the @/ alias here.

export const ATTENDANCE_STATES = ["present", "remote", "excused", "unexcused"] as const;
export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export const STATE_LABELS: Record<AttendanceState, string> = {
  present: "Present",
  remote: "Remote",
  excused: "Excused",
  unexcused: "Unexcused",
};

/** confirmed: in the calendar. cancelled: STATUS:CANCELLED in the calendar. removed: missing from the latest import. */
export const MEETING_STATUSES = ["confirmed", "cancelled", "removed"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Who set an attendance record: the member, an admin, or the sandbox import. */
export const ATTENDANCE_SOURCES = ["self", "admin", "seed"] as const;

export const EMAIL_STATUSES = ["sent", "logged", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Members can check in (present or remote) from this long before the start until this long after the end. */
export const CHECKIN_OPENS_MINUTES = 15;
export const CHECKIN_CLOSES_MINUTES = 15;
/** Members can send an excuse until this long after the meeting ends; after that only admins change it. */
export const EXCUSE_HOURS_AFTER_END = 24;

/** Reminder choices in minutes before the start, longest first. */
export const REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 7 * 24 * 60, label: "1 week before" },
  { minutes: 3 * 24 * 60, label: "3 days before" },
  { minutes: 24 * 60, label: "1 day before" },
  { minutes: 3 * 60, label: "3 hours before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 10, label: "10 minutes before" },
];
export const DEFAULT_REMINDER_MINUTES = [24 * 60, 10];
