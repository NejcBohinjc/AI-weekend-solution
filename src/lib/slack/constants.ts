// Slack extras (optional, only with SLACK_BOT_TOKEN). Shared constants, safe to import anywhere.

/** Meeting announcements in Slack: how long before the start each one is posted. */
export const ANNOUNCEMENT_KINDS = [
  { kind: "3d", minutes: 3 * 24 * 60, label: "3 days before" },
  { kind: "1d", minutes: 24 * 60, label: "1 day before" },
] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number]["kind"];
export const ANNOUNCEMENT_KIND_VALUES = ANNOUNCEMENT_KINDS.map((k) => k.kind) as [AnnouncementKind, ...AnnouncementKind[]];

export const ANNOUNCEMENT_STATUSES = ["scheduled", "posted", "cancelled", "failed"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** Slack schedules messages at most 120 days ahead. */
export const SLACK_SCHEDULE_MAX_DAYS = 120;
/** An announcement whose moment has passed is still posted late, unless the meeting starts within this. */
export const LATE_POST_MIN_MINUTES_BEFORE = 60;
/** The channel used for series without their own channel. */
export const DEFAULT_SERIES = "*";
/** Background runs (page loads) at most this often; "Sync now" always runs. */
export const SLACK_SYNC_SECONDS = 5 * 60;
