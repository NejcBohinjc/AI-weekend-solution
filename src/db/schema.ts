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
import { SHEET_STATUSES, TIME_ENTRY_SOURCES, WORK_LOCATIONS } from "../lib/hours/constants";
import {
  ATTENDANCE_SOURCES,
  ATTENDANCE_STATES,
  DEFAULT_REMINDER_MINUTES,
  EMAIL_STATUSES,
  REMINDER_STATUSES,
  MEETING_STATUSES,
  RECORDING_SOURCES,
  RECORDING_STATUSES,
} from "../lib/meetings/constants";
import { DEFAULT_PRIORITY, DEFAULT_TASK_REMINDER_DAYS, TASK_PRIORITIES, TASK_STATUSES } from "../lib/tasks/constants";
import { LATE_DECISIONS, TASK_KINDS } from "../lib/absence-rules";
import { TIERS } from "../lib/tiers"; // relative: drizzle-kit does not resolve the @/ alias
// The meeting recorder's statuses (recordings table); RECORDING_STATUSES above is for meeting_recordings.
import { RECORDING_STATUSES as RECORDER_STATUSES, SEGMENT_STATUSES } from "../lib/recordings/constants";

export { TIER_HOURS, TIERS, type Tier } from "../lib/tiers";

// Departments (Core, Voice, Tech to start; admins add more on /admin/departments). A member belongs to
// any number of them (member_departments) or none; a department named like a tier ("Core") is only for
// members of that tier. A task can be delegated to a whole department instead of one person.
export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Department = typeof departments.$inferSelect;

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

export const memberDepartments = pgTable(
  "member_departments",
  {
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.departmentId] }), index("member_departments_department_idx").on(t.departmentId)],
);

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

// Projects group tasks (app-only: the tasks tab of the sheet has no project column). Admins add,
// rename and delete them on /projects; a task belongs to at most one.
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projects.$inferSelect;

// Tasks. Imported tasks carry the raw sheet values so admins can see what the sheet said.
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    // "project" tasks are the normal ones; "general" tasks are standing tasks members pick after missing
    // a meeting (never done, not synced to the sheet; see lib/absence-rules.ts).
    kind: text("kind", { enum: TASK_KINDS }).notNull().default("project"),
    description: text("description"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    assigneeId: integer("assignee_id").references(() => members.id, { onDelete: "set null" }),
    // Delegated to a whole department instead of one person (never both; see the check below).
    departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    type: text("type"), // normalised label, e.g. "marketing"
    dueDate: date("due_date"), // calendar date in Europe/Ljubljana
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default(DEFAULT_PRIORITY),
    createdById: integer("created_by_id").references(() => members.id, { onDelete: "set null" }),
    // Where the task came from: "app" or "gsheet".
    source: text("source").notNull().default("app"),
    // The task's key in the sheet's "id" column; null until the sync has given it one.
    sheetKey: text("sheet_key").unique(),
    // The task's fields as the sheet held them after the last sync (the base of the three-way merge).
    sheetSnapshot: jsonb("sheet_snapshot").$type<TaskSheetSnapshot>(),
    // Legacy row key from before the id column (normalised title + occurrence); matches rows that have no id yet.
    sourceKey: text("source_key"),
    sheetRow: integer("sheet_row"),
    inSheet: boolean("in_sheet").notNull().default(true),
    statusRaw: text("status_raw"),
    assigneeRaw: text("assignee_raw"),
    typeRaw: text("type_raw"),
    deadlineRaw: text("deadline_raw"),
    // AI-created tasks (from meeting notes). created_by_id stays null for them; triggered_by_id is the
    // member who ran it. They start unconfirmed until the assignee confirms (ai_confirmed_at).
    createdByAi: boolean("created_by_ai").notNull().default(false),
    sourceMeetingId: integer("source_meeting_id").references(() => meetings.id, { onDelete: "set null" }),
    sourceQuote: text("source_quote"),
    aiModel: text("ai_model"),
    triggeredById: integer("triggered_by_id").references(() => members.id, { onDelete: "set null" }),
    aiConfirmedAt: timestamp("ai_confirmed_at", { withTimezone: true }),
    // When the task was last marked done (cleared when it is reopened), and the status it had before,
    // so unticking puts it back. Set by every path that changes the status (app and sheet sync).
    completedAt: timestamp("completed_at", { withTimezone: true }),
    statusBeforeDone: text("status_before_done", { enum: TASK_STATUSES }),
    // Soft delete (AI tasks): hidden everywhere; the sync removes its sheet row.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Legacy (read-only import): fields an admin changed in the app. Only used to migrate to the two-way sync.
    lockedFields: text("locked_fields").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_source_key_idx").on(t.source, t.sourceKey),
    index("tasks_assignee_idx").on(t.assigneeId),
    // "My open tasks" (dashboard, /tasks): by assignee, soonest due first.
    index("tasks_open_assignee_idx")
      .on(t.assigneeId, t.dueDate)
      .where(sql`${t.deletedAt} is null and ${t.kind} = 'project' and ${t.status} <> 'done'`),
    // Analytics: tasks created or finished since a date; and the tasks of a meeting.
    index("tasks_created_idx").on(t.createdAt).where(sql`${t.deletedAt} is null`),
    index("tasks_completed_idx").on(t.completedAt).where(sql`${t.completedAt} is not null`),
    index("tasks_source_meeting_idx").on(t.sourceMeetingId).where(sql`${t.sourceMeetingId} is not null`),
    index("tasks_department_idx").on(t.departmentId),
    index("tasks_project_idx").on(t.projectId),
    check("tasks_one_owner", sql`${t.assigneeId} is null or ${t.departmentId} is null`),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type TaskSheetSnapshot = {
  title: string;
  status: (typeof TASK_STATUSES)[number];
  assigneeId: number | null;
  // Missing in snapshots from before departments existed: read it as null.
  departmentId?: number | null;
  type: string | null;
  dueDate: string | null;
  // Null: the sheet's priority cell was empty or unreadable (the sync then writes the app's value).
  // Missing in snapshots from before priorities existed: read it as null.
  priority?: (typeof TASK_PRIORITIES)[number] | null;
};

// Task history: one row per creation or per changed field. actorId null means the sheet sync did it.
export const taskEvents = pgTable(
  "task_events",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
    source: text("source", { enum: ["app", "sheet_sync", "ai"] }).notNull(),
    kind: text("kind", { enum: ["created", "updated", "conflict", "confirmed", "deleted", "reopened", "picked"] }).notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_events_task_idx").on(t.taskId, t.createdAt),
    // Analytics "active this week": who changed a task from the app in a period.
    index("task_events_activity_idx").on(t.createdAt).where(sql`${t.actorId} is not null and ${t.source} = 'app'`),
  ],
);

// Background jobs (tasks sheet sync, hours sheet sync): a lease so only one runs at a time across
// serverless instances, plus when it last ran and how it went.
export const syncState = pgTable("sync_state", {
  name: text("name").primaryKey(),
  runningSince: timestamp("running_since", { withTimezone: true }),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastFinishedAt: timestamp("last_finished_at", { withTimezone: true }),
  lastOk: boolean("last_ok"),
  lastError: text("last_error"),
});

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
    // "office" or "home"; null for entries from before locations existed ("unspecified").
    location: text("location", { enum: WORK_LOCATIONS }),
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
    // Entries of everyone in a period (admin "this week" table, analytics), without a member filter.
    index("time_entries_started_idx").on(t.startedAt).where(sql`${t.deletedAt} is null`),
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
    // The calendar event's description for people to read (machine lines "Series:"/"Members:" removed).
    description: text("description"),
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
    // An excuse sent less than ABSENCE_NOTICE_HOURS before the start: counts as unexcused until an
    // admin accepts it (late_decision "accepted").
    lateNotice: boolean("late_notice").notNull().default(false),
    noticeAt: timestamp("notice_at", { withTimezone: true }),
    lateDecision: text("late_decision", { enum: LATE_DECISIONS }),
    lateDecidedById: integer("late_decided_by_id").references(() => members.id, { onDelete: "set null" }),
    lateDecidedAt: timestamp("late_decided_at", { withTimezone: true }),
    source: text("source", { enum: ATTENDANCE_SOURCES }).notNull(),
    setById: integer("set_by_id").references(() => members.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.memberId] }),
    index("attendance_member_idx").on(t.memberId),
    // Late notices waiting for an admin's decision (admin meetings page).
    index("attendance_late_pending_idx")
      .on(t.meetingId)
      .where(sql`${t.state} = 'excused' and ${t.lateNotice} and ${t.lateDecision} is null`),
  ],
);

export type Attendance = typeof attendance.$inferSelect;

// A member's reminder choices. No row means the defaults (1 day and 10 minutes before, by email).
export const reminderSettings = pgTable("reminder_settings", {
  memberId: integer("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  minutesBefore: integer("minutes_before").array().notNull().default(DEFAULT_REMINDER_MINUTES),
  // Task deadline reminders: on/off and the days before the due date (0 = on the due day).
  taskEmailEnabled: boolean("task_email_enabled").notNull().default(true),
  taskDaysBefore: integer("task_days_before").array().notNull().default(DEFAULT_TASK_REMINDER_DAYS),
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
    // Claimed as "pending" in a short transaction, the email is sent outside it, then the row becomes
    // "sent" or "failed". A pending row older than 10 minutes (a run that died) is claimed again.
    // Rows from before this column count as sent.
    status: text("status", { enum: REMINDER_STATUSES }).notNull().default("sent"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.memberId, t.minutesBefore] })],
);

// Task deadline reminders already handled, so none is sent twice. The due date is part of the key:
// a rescheduled task gets its reminders again.
export const taskReminders = pgTable(
  "task_reminders",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    dueDate: date("due_date").notNull(),
    daysBefore: integer("days_before").notNull(),
    emailId: integer("email_id").references(() => emailLog.id, { onDelete: "set null" }),
    // As in meeting_reminders: claimed pending, sent outside the transaction, then sent or failed.
    status: text("status", { enum: REMINDER_STATUSES }).notNull().default("sent"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.memberId, t.dueDate, t.daysBefore] })],
);

// One row per calendar import (file upload, calendar URL or seed), with the report.
// Earlier meeting recordings (the first recorder: one file per meeting in an S3-compatible bucket, see
// lib/storage.ts). No new rows are made: the meeting recorder (recordings + recording_segments below)
// replaced it. Kept so recordings already stored stay playable for the meeting's invitees and admins.
export const meetingRecordings = pgTable(
  "meeting_recordings",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    uploadedById: integer("uploaded_by_id").references(() => members.id, { onDelete: "set null" }),
    source: text("source", { enum: RECORDING_SOURCES }).notNull(),
    status: text("status", { enum: RECORDING_STATUSES }).notNull().default("uploading"),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name"),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [index("meeting_recordings_meeting_idx").on(t.meetingId)],
);

export type MeetingRecording = typeof meetingRecordings.$inferSelect;

export const meetingImports = pgTable(
  "meeting_imports",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id").references(() => members.id, { onDelete: "set null" }),
    source: text("source", { enum: ["file", "url", "seed"] }).notNull(),
    ok: boolean("ok").notNull(),
    report: jsonb("report").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The latest pull of the calendar is looked up on page views; the table gets a row per attempt.
  (t) => [index("meeting_imports_source_idx").on(t.source, t.id)],
);

// Meeting notes or a transcript, pasted or uploaded by an attendee. Readable by that meeting's
// invitees and admins only (enforced in the app).
export const meetingNotes = pgTable(
  "meeting_notes",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    authorId: integer("author_id").references(() => members.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(), // SHA-256 of content
    fileName: text("file_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meeting_notes_meeting_idx").on(t.meetingId)],
);

// One "Create tasks from notes" run: the validated items the model returned and what was created.
export const aiTaskRuns = pgTable(
  "ai_task_runs",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    noteId: integer("note_id").references(() => meetingNotes.id, { onDelete: "set null" }),
    notesHash: text("notes_hash").notNull(),
    triggeredById: integer("triggered_by_id").references(() => members.id, { onDelete: "set null" }),
    model: text("model"),
    calledApi: boolean("called_api").notNull(), // false when the items of an earlier run were reused
    ok: boolean("ok").notNull(),
    error: text("error"),
    items: jsonb("items").notNull().default([]),
    created: integer("created").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    discarded: integer("discarded").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_task_runs_meeting_idx").on(t.meetingId, t.notesHash),
    index("ai_task_runs_member_idx").on(t.triggeredById, t.createdAt),
    // "Is there a successful run for this note?" (notes waiting on the dashboard, per-note status).
    index("ai_task_runs_note_idx").on(t.noteId),
  ],
);

// One "Ask about a meeting" question: for the per-member rate limit and usage. The question and the
// answer are not stored.
export const aiQuestions = pgTable(
  "ai_questions",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
    meetingId: integer("meeting_id").references(() => meetings.id, { onDelete: "set null" }),
    model: text("model"),
    ok: boolean("ok").notNull(),
    found: boolean("found"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_questions_member_idx").on(t.memberId, t.createdAt)],
);

// Every action item ever created for a meeting, by title + assignee. A rerun skips these, so
// nothing is duplicated and a task deleted by its assignee is not recreated.
export const aiTaskItems = pgTable(
  "ai_task_items",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    runId: integer("run_id").references(() => aiTaskRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_task_items_key_idx").on(t.meetingId, t.itemKey)],
);

// In-app notifications. Each one belongs to one member and is only ever shown to that member, so
// nothing admin-only may go into the text.
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    text: text("text").notNull(),
    link: text("link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("notifications_member_idx").on(t.memberId, t.readAt), index("notifications_member_created_idx").on(t.memberId, t.createdAt)],
);

// After a missed meeting (see GENERAL_TASK_AFTER): the member is asked to pick a general task.
export const generalTaskRequests = pgTable(
  "general_task_requests",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(), // "unexcused", "late notice not accepted", ...
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pickedTaskId: integer("picked_task_id").references(() => tasks.id, { onDelete: "set null" }),
    pickedAt: timestamp("picked_at", { withTimezone: true }),
    // The absence was changed (e.g. to present) before a task was picked.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("general_task_requests_member_meeting_idx").on(t.memberId, t.meetingId)],
);

// A meeting recording (recorded in the browser, or an imported audio file). Only admins create,
// transcribe and delete them; admins and the meeting's invitees can play them. The audio lives in the
// private Supabase Storage bucket "meeting-recordings", one file per segment.
export const recordings = pgTable(
  "recordings",
  {
    id: serial("id").primaryKey(),
    meetingId: integer("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    startedById: integer("started_by_id").references(() => members.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status", { enum: RECORDER_STATUSES }).notNull().default("recording"),
    error: text("error"),
    source: text("source", { enum: ["recorded", "uploaded"] }).notNull().default("recorded"),
    fileName: text("file_name"), // for imported files
    // Transcription: languages hint ("sl", "sl,en", "" = detect), the joined transcript, usage.
    languages: text("languages"),
    transcript: text("transcript"),
    transcribeModel: text("transcribe_model"),
    transcribedSeconds: integer("transcribed_seconds").notNull().default(0),
    transcribeLeaseUntil: timestamp("transcribe_lease_until", { withTimezone: true }),
    savedNoteId: integer("saved_note_id").references(() => meetingNotes.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recordings_meeting_idx").on(t.meetingId)],
);

// One uploaded piece of a recording (~10 minutes). Unique per (recording, index), so a retried upload
// never adds a second row.
export const recordingSegments = pgTable(
  "recording_segments",
  {
    id: serial("id").primaryKey(),
    recordingId: integer("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    storagePath: text("storage_path").notNull(),
    contentType: text("content_type").notNull().default("audio/mpeg"),
    durationMs: integer("duration_ms").notNull(),
    bytes: integer("bytes").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    transcript: text("transcript"),
    transcriptStatus: text("transcript_status", { enum: SEGMENT_STATUSES }),
    transcriptError: text("transcript_error"),
    transcriptStartedAt: timestamp("transcript_started_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("recording_segments_recording_index_uq").on(t.recordingId, t.index)],
);

export type Recording = typeof recordings.$inferSelect;
export type RecordingSegment = typeof recordingSegments.$inferSelect;
