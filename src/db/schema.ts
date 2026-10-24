import { boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
