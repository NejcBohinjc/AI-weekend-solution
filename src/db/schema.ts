import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { SHEET_STATUSES, TIME_ENTRY_SOURCES } from "../lib/hours/constants";
import {
  ATTENDANCE_SOURCES,
  ATTENDANCE_STATES,
  DEFAULT_REMINDER_MINUTES,
  EMAIL_STATUSES,
  MEETING_STATUSES,
} from "../lib/meetings/constants";
import { TASK_STATUSES } from "../lib/tasks/constants";
import { TIERS } from "../lib/tiers"; // relative: drizzle-kit does not resolve the @/ alias

export { TIER_HOURS, TIERS, type Tier } from "../lib/tiers";

export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // always stored lowercase
  tier: text("tier", { enum: TIERS }).notNull(),
  weeklyHours: integer("weekly_hours").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  active: boolean("active").notNull().default(true),
  passwordHash: text("password_hash"), // argon2id; null until the member sets one
  series: text("series").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Member = typeof members.$inferSelect;

// The id is the SHA-256 hash of the cookie token, so a database leak does not leak sessions.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_member_idx").on(t.memberId)],
);

// One-time links for setting or resetting a password. Only the token's hash is stored.
export const passwordTokens = pgTable(
  "password_tokens",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_tokens_member_idx").on(t.memberId)],
);

// Failed sign-in attempts, used for rate limiting. Kept in the database so limits hold on serverless.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    ip: text("ip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt), index("login_attempts_ip_idx").on(t.ip, t.createdAt)],
);

// Tasks. Imported tasks carry the raw sheet values so admins can see what the sheet said.
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    assigneeId: integer("assignee_id").references(() => members.id, { onDelete: "set null" }),
    type: text("type"), // normalised label, e.g. "marketing"
    dueDate: date("due_date"), // calendar date in Europe/Ljubljana
    // Where the task came from: "app" or "gsheet". sourceKey identifies the sheet row (see lib/tasks/sheet-sync.ts).
    source: text("source").notNull().default("app"),
    sourceKey: text("source_key"),
    sheetRow: integer("sheet_row"),
    inSheet: boolean("in_sheet").notNull().default(true),
    statusRaw: text("status_raw"),
    assigneeRaw: text("assignee_raw"),
    typeRaw: text("type_raw"),
    deadlineRaw: text("deadline_raw"),
    // Fields an admin changed in the app; sheet syncs never overwrite these.
    lockedFields: text("locked_fields").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_source_key_idx").on(t.source, t.sourceKey),
    index("tasks_assignee_idx").on(t.assigneeId),
  ],
);

export type Task = typeof tasks.$inferSelect;

// Task history: one row per creation or per changed field. actorId null means the sheet sync did it.
export const taskEvents = pgTable(
  "task_events",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
    source: text("source", { enum: ["app", "sheet_sync"] }).notNull(),
    kind: text("kind", { enum: ["created", "updated"] }).notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_events_task_idx").on(t.taskId, t.createdAt)],
);

// One row per "Sync from Google Sheets" run, with the full report.
export const taskSyncs = pgTable("task_syncs", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
  ok: boolean("ok").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Work hours. One row per stretch of work; ended_at is null while the timer runs.
// The database is the source of truth; finished entries are mirrored to the "Ure dela" sheet tab
// (see lib/hours/sheet-sync.ts). Deleted entries are kept (deleted_at) until their sheet row is removed.
export const timeEntries = pgTable(
  "time_entries",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    source: text("source", { enum: TIME_ENTRY_SOURCES }).notNull(),
    // Who created or last changed the entry, when it was not the member (an admin).
    editedById: integer("edited_by_id").references(() => members.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    sheetStatus: text("sheet_status", { enum: SHEET_STATUSES }).notNull().default("pending"),
    sheetError: text("sheet_error"),
    sheetSyncedAt: timestamp("sheet_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one running timer per member, so a double tap on Start cannot create two.
    uniqueIndex("time_entries_running_idx").on(t.memberId).where(sql`${t.endedAt} is null and ${t.deletedAt} is null`),
    index("time_entries_member_idx").on(t.memberId, t.startedAt),
    index("time_entries_sheet_idx").on(t.sheetStatus),
    check("time_entries_end_after_start", sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`),
  ],
);

export type TimeEntry = typeof timeEntries.$inferSelect;

// Meetings, imported read-only from the Google Calendar's iCal (.ics) export (see lib/meetings/ics.ts).
// uid is the event UID; an occurrence of a recurring event gets "<UID>#<start in UTC>".
export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    uid: text("uid").notNull().unique(),
    title: text("title").notNull(),
    series: text("series").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location"),
    status: text("status", { enum: MEETING_STATUSES }).notNull().default("confirmed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meetings_starts_idx").on(t.startsAt)],
);

export type Meeting = typeof meetings.$inferSelect;

// Who is invited, matched by email to members. Replaced on every import.
export const meetingInvites = pgTable(
  "meeting_invites",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.memberId] }), index("meeting_invites_member_idx").on(t.memberId)],
);

// Attendance someone recorded. No row for a meeting that has ended means "unexcused" (see lib/meetings/rules.ts).
export const attendance = pgTable(
  "attendance",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    state: text("state", { enum: ATTENDANCE_STATES }).notNull(),
    note: text("note"), // the reason given with an excuse
    source: text("source", { enum: ATTENDANCE_SOURCES }).notNull(),
    setById: integer("set_by_id").references(() => members.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.memberId] }), index("attendance_member_idx").on(t.memberId)],
);

export type Attendance = typeof attendance.$inferSelect;

// A member's reminder choices. No row means the defaults (1 day and 10 minutes before, by email).
export const reminderSettings = pgTable("reminder_settings", {
  memberId: integer("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  minutesBefore: integer("minutes_before").array().notNull().default(DEFAULT_REMINDER_MINUTES),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every email the app produced. "logged" means it was not sent because no SMTP server is configured.
export const emailLog = pgTable(
  "email_log",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: EMAIL_STATUSES }).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_log_created_idx").on(t.createdAt)],
);

// Reminders already handled, one row per meeting, member and "minutes before", so none is sent twice.
export const meetingReminders = pgTable(
  "meeting_reminders",
  {
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    minutesBefore: integer("minutes_before").notNull(),
    emailId: integer("email_id").references(() => emailLog.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.memberId, t.minutesBefore] })],
);

// One row per calendar import (file upload, calendar URL or seed), with the report.
export const meetingImports = pgTable("meeting_imports", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
  source: text("source", { enum: ["file", "url", "seed"] }).notNull(),
  ok: boolean("ok").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
