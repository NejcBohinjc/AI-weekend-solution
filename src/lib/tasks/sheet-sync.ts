// Two-way sync between the tasks table and the tasks tab of the Google Sheet.
//
// Identity: every row carries the task's key (e.g. "t-3f9a2b7c1d") in the "id" column, so sorting the
// sheet or syncing twice never duplicates. Rows without a key (typed into the sheet, or from before
// the id column) are matched once by their legacy key (normalised title + occurrence), else created;
// either way the key is written back. Keys are saved in the database before the sheet is written, so a
// failed write cannot create duplicates later.
//
// Conflicts: per field, a three-way merge against sheet_snapshot (what the sheet held after the last
// sync). Changed only in the sheet -> the app takes it. Changed only in the app -> written to the
// sheet. Changed on both sides -> the app wins (the sheet gives no edit times, so "most recent" cannot
// be known); the overwritten sheet value is kept in the task history and the admin report.
//
// Deleted tasks (tasks.deleted_at): their row is deleted from the sheet; never re-added or re-imported.
//
// Scope: only the tasks tab is opened. Only row 1 (header names) and the six mapped columns are read,
// and only those cells are written, so other columns (e.g. Geslo) are never read or written.
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { members, taskEvents, tasks, taskSyncs, type Task, type TaskSheetSnapshot } from "@/db/schema";
import { columnLetter, describeGoogleError, openTab, plainText, type Cell, type SheetsApi } from "@/lib/google/sheets";
import { acquireSync, finishSync } from "@/lib/sync-state";
import { STATUS_LABELS, type TaskStatus } from "./constants";
import { completionFields, isReopen } from "./done";
import {
  buildRowKeys,
  detectAssigneeStyle,
  findColumns,
  findIdColumn,
  formatAssignee,
  formatDeadline,
  formatStatus,
  mapStatus,
  matchAssignee,
  normalizeType,
  parseDeadline,
  todayInLjubljana,
  type MemberRef,
  type SheetField,
} from "./sheet-mapping";

export const TASKS_SYNC = "tasks_sheet";
export const SHEET_SOURCE = "gsheet";
/** Background syncs (page loads, login) start only if the last one finished at least this long ago. */
export const AUTO_SYNC_SECONDS = 60;

export function tasksSheetTab(): string {
  return process.env.GOOGLE_SHEET_TASKS_TAB || "List1";
}

type RowRef = { row: number; title: string };
export type SyncReport = {
  ok: boolean;
  error?: string;
  tab?: string;
  at: string;
  rowsRead: number;
  created: RowRef[]; // new tasks from sheet rows
  updated: (RowRef & { fields: string[] })[]; // app tasks changed from the sheet
  exported: (RowRef & { fields: string[] })[]; // app changes written to existing rows
  appended: RowRef[]; // tasks created in the app, added as new rows
  conflicts: (RowRef & { field: string; sheetValue: string | null; appValue: string | null })[];
  unchanged: number;
  skipped: { row: number; reason: string }[];
  unassigned: (RowRef & { raw: string; reason: string })[];
  warnings: (RowRef & { message: string })[];
  noLongerInSheet: { title: string }[];
  removedFromSheet: { title: string }[]; // tasks deleted in the app: their rows were deleted
  missingColumns: string[];
};

export function emptyReport(at = new Date()): SyncReport {
  return {
    ok: true,
    at: at.toISOString(),
    rowsRead: 0,
    created: [],
    updated: [],
    exported: [],
    appended: [],
    conflicts: [],
    unchanged: 0,
    skipped: [],
    unassigned: [],
    warnings: [],
    noLongerInSheet: [],
    removedFromSheet: [],
    missingColumns: [],
  };
}

const FIELDS = ["title", "status", "assigneeId", "type", "dueDate"] as const;
type Field = (typeof FIELDS)[number];
const COLUMN_OF: Record<Field, SheetField> = { title: "title", status: "status", assigneeId: "assignee", type: "type", dueDate: "deadline" };

const isEmpty = (c: Cell) => c === undefined || c === null || String(c).trim() === "";
const rawText = (c: Cell) => (isEmpty(c) ? null : String(c).trim());
const cleanTitle = (c: Cell) => String(c).replace(/\s+/g, " ").trim();
const newKey = () => `t-${randomBytes(5).toString("hex")}`;
const pick = (t: TaskSheetSnapshot): TaskSheetSnapshot => ({ title: t.title, status: t.status, assigneeId: t.assigneeId, type: t.type, dueDate: t.dueDate });

type SheetRow = { row: number; key: string | null; cells: Record<SheetField, Cell> };
type NewEvent = typeof taskEvents.$inferInsert;

/** One sync run, without the lease. App code calls runTasksSync(). */
export async function syncTasks({
  actorId,
  api,
  sheetId,
  today = todayInLjubljana(),
}: {
  actorId: number | null;
  api?: SheetsApi;
  sheetId?: string;
  today?: string;
}): Promise<SyncReport> {
  const report = emptyReport();
  const tab = openTab(tasksSheetTab(), api, sheetId);
  report.tab = tab.tab;

  // ---- Read: header names, then only our columns ----
  const header = (await tab.get("1:1"))[0] ?? [];
  const { columns, missing } = findColumns(header);
  report.missingColumns = missing;
  if (columns.title === undefined) throw new Error(`Tab "${tab.tab}" has no "task" column in its first row.`);
  let idCol = findIdColumn(header);
  if (idCol < 0) {
    idCol = header.length; // the first free column after the last header
    await tab.write(`${columnLetter(idCol)}1`, [["id"]]);
  }
  const fields = Object.keys(columns) as SheetField[];
  const ranges = [...fields.map((f) => columns[f]!), idCol].map((c) => `${columnLetter(c)}2:${columnLetter(c)}`);
  const colData = await tab.getColumns(ranges);
  const height = Math.max(0, ...colData.map((c) => c.length));
  const sheetRows: SheetRow[] = [];
  for (let i = 0; i < height; i++) {
    const cells = Object.fromEntries(fields.map((f, j) => [f, colData[j][i]])) as Record<SheetField, Cell>;
    const key = rawText(colData[fields.length][i]);
    if (Object.values(cells).every(isEmpty) && !key) continue;
    sheetRows.push({ row: i + 2, key, cells });
  }
  report.rowsRead = sheetRows.length;

  const memberRefs: MemberRef[] = await db
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(eq(members.active, true));
  const memberById = new Map(memberRefs.map((m) => [m.id, m]));
  const allNames = new Map((await db.select({ id: members.id, name: members.name }).from(members)).map((m) => [m.id, m.name]));
  const style = detectAssigneeStyle(sheetRows.map((r) => r.cells.assignee));
  const show: Record<Field, (v: unknown) => string | null> = {
    title: (v) => (v as string) ?? null,
    status: (v) => (v ? STATUS_LABELS[v as TaskStatus] : null),
    assigneeId: (v) => (v ? (allNames.get(v as number) ?? `#${v}`) : null),
    type: (v) => (v as string) ?? null,
    dueDate: (v) => (v as string) ?? null,
  };
  const cellText: Record<Field, (v: unknown) => Cell> = {
    title: (v) => plainText(v as string),
    status: (v) => formatStatus(v as TaskStatus),
    assigneeId: (v) => {
      if (!v) return "";
      const m = memberById.get(v as number);
      return plainText(m ? formatAssignee(m, style, memberRefs) : (allNames.get(v as number) ?? ""));
    },
    type: (v) => (v ? plainText(v as string) : ""),
    dueDate: (v) => (v ? formatDeadline(v as string) : ""),
  };
  const writable = (f: Field) => columns[COLUMN_OF[f]] !== undefined;
  const cellRange = (f: Field, row: number) => `${columnLetter(columns[COLUMN_OF[f]]!)}${row}`;
  const idRange = (row: number) => `${columnLetter(idCol)}${row}`;

  // General tasks never go to the sheet (lib/absence-rules.ts); they are only looked up to guard them.
  const allTasks = await db.select().from(tasks);
  const byKey = new Map(allTasks.filter((t) => t.sheetKey).map((t) => [t.sheetKey!, t]));

  // A key may appear once; a copied row repeating another row's key is treated as a new row.
  const usedKeys = new Set<string>();
  const rowsWithKey: SheetRow[] = [];
  const rowsWithoutKey: SheetRow[] = [];
  for (const r of sheetRows) {
    if (r.key && !usedKeys.has(r.key)) {
      usedKeys.add(r.key);
      rowsWithKey.push(r);
    } else rowsWithoutKey.push({ ...r, key: null });
  }
  const titled = rowsWithoutKey.filter((r) => !isEmpty(r.cells.title));
  const legacyKeys = buildRowKeys(titled.map((r) => cleanTitle(r.cells.title)));
  const legacyByRow = new Map(titled.map((r, i) => [r.row, legacyKeys[i]]));
  // Tasks a keyless row may belong to: same legacy key, and not already matched through its key.
  const legacyCandidates = new Map(
    allTasks.filter((t) => !t.deletedAt && t.sourceKey && !(t.sheetKey && usedKeys.has(t.sheetKey))).map((t) => [t.sourceKey!, t]),
  );
  const rowsToDelete: { row: number; task: Task }[] = [];

  // ---- Plan ----
  const creates: { key: string; legacyKey: string | null; values: TaskSheetSnapshot; raw: Partial<Task>; row: number }[] = [];
  const updates: { taskId: number; set: Partial<Task>; events: NewEvent[] }[] = [];
  const writes: { range: string; values: Cell[][] }[] = [];
  const afterWrite = new Map<number, Partial<Task>>(); // task id -> saved once the sheet is written
  const handled = new Set<number>(); // task ids matched to a row

  const mapRow = (r: SheetRow, current: Task | null) => {
    const ref = { row: r.row, title: cleanTitle(r.cells.title) };
    const status = mapStatus(r.cells.status);
    if (!status.recognised) report.warnings.push({ ...ref, message: `unknown status "${rawText(r.cells.status)}", read as To do` });
    const assignee = matchAssignee(r.cells.assignee, memberRefs);
    const deadline = parseDeadline(r.cells.deadline, today);
    if (deadline.error) {
      const kept = current?.dueDate ? "kept the app's due date" : "left empty";
      report.warnings.push({ ...ref, message: `deadline "${rawText(r.cells.deadline)}" ${deadline.error}, ${kept}` });
    }
    const values: TaskSheetSnapshot = {
      title: ref.title,
      status: status.status,
      assigneeId: assignee.memberId,
      type: normalizeType(r.cells.type),
      // An unreadable deadline never wipes a due date the app already has.
      dueDate: deadline.error ? (current?.dueDate ?? null) : deadline.date,
    };
    // Columns the sheet does not have keep the app's value.
    if (current) for (const f of FIELDS) if (!writable(f)) (values as Record<Field, unknown>)[f] = current[f];
    const raw = {
      statusRaw: rawText(r.cells.status),
      assigneeRaw: rawText(r.cells.assignee),
      typeRaw: rawText(r.cells.type),
      deadlineRaw: rawText(r.cells.deadline),
      sheetRow: r.row,
      inSheet: true,
    };
    // Reported only if the task ends up without an assignee (the app may have one to write back).
    const reportUnassigned = (finalAssignee: number | null) => {
      if (assignee.reason && finalAssignee === null) report.unassigned.push({ ...ref, raw: rawText(r.cells.assignee)!, reason: assignee.reason });
    };
    return { ref, values, raw, reportUnassigned };
  };

  /** Three-way merge of an existing task with its row. */
  const merge = (r: SheetRow, task: Task, key: string, writeKey: boolean) => {
    handled.add(task.id);
    const { ref, values: s, raw, reportUnassigned } = mapRow(r, task);
    if (task.kind === "general" && s.status === "done") {
      // General tasks are never done: keep the app's status, whatever the sheet says.
      s.status = task.status;
      report.warnings.push({ ...ref, message: "general tasks can't be done; kept its status" });
    }
    // Base: the sheet as of the last sync. Tasks from the earlier read-only import have none yet: there,
    // fields an admin had edited (locked) count as app changes and everything else follows the sheet.
    const base: TaskSheetSnapshot =
      task.sheetSnapshot ?? (Object.fromEntries(FIELDS.map((f) => [f, task.lockedFields.includes(f) ? s[f] : task[f]])) as TaskSheetSnapshot);
    const final = pick(task);
    const fromSheet: Field[] = [];
    const toSheet: Field[] = [];
    const events: NewEvent[] = [];
    for (const f of FIELDS) {
      const sheetChanged = s[f] !== base[f];
      const appChanged = task[f] !== base[f];
      if (sheetChanged && !appChanged) {
        (final as Record<Field, unknown>)[f] = s[f];
        fromSheet.push(f);
        const kind = f === "status" && isReopen(task.status, s.status) ? "reopened" : "updated";
        events.push({ taskId: task.id, actorId, source: "sheet_sync", kind, field: f, oldValue: show[f](task[f]), newValue: show[f](s[f]) });
      } else if (appChanged && s[f] !== task[f] && writable(f)) {
        toSheet.push(f);
        if (sheetChanged) {
          report.conflicts.push({ ...ref, field: f, sheetValue: show[f](s[f]), appValue: show[f](task[f]) });
          events.push({ taskId: task.id, actorId, source: "sheet_sync", kind: "conflict", field: f, oldValue: show[f](s[f]), newValue: show[f](task[f]) });
        }
      }
    }
    reportUnassigned(final.assigneeId);
    for (const f of toSheet) writes.push({ range: cellRange(f, r.row), values: [[cellText[f](task[f])]] });
    if (writeKey) writes.push({ range: idRange(r.row), values: [[key]] });

    // The snapshot is what the sheet holds: fields still to be written are recorded after the write.
    const snapshotNow = { ...final };
    for (const f of toSheet) (snapshotNow as Record<Field, unknown>)[f] = s[f];
    updates.push({
      taskId: task.id,
      set: {
        ...Object.fromEntries(fromSheet.map((f) => [f, final[f]])),
        // Ticked or unticked in the sheet: completion time and earlier status as for a change in the app.
        ...(fromSheet.includes("status") ? completionFields(task, final.status, new Date()) : null),
        ...raw,
        sheetKey: key,
        sheetSnapshot: snapshotNow,
        ...(fromSheet.length && { updatedAt: new Date() }),
      },
      events,
    });
    if (toSheet.length) afterWrite.set(task.id, { sheetSnapshot: final });
    if (fromSheet.length) report.updated.push({ ...ref, fields: fromSheet });
    if (toSheet.length) report.exported.push({ ...ref, fields: toSheet });
    if (!fromSheet.length && !toSheet.length) report.unchanged++;
  };

  const takenLegacyKeys = new Set(allTasks.filter((t) => t.source === SHEET_SOURCE && t.sourceKey).map((t) => t.sourceKey!));
  const create = (r: SheetRow, key: string, legacyKey: string | null) => {
    const { values, raw, reportUnassigned } = mapRow(r, null);
    reportUnassigned(values.assigneeId);
    // The legacy key lets the next sync find this task if writing its key to the row fails. A copied
    // row repeats an existing legacy key, which must stay unique, so it goes without.
    creates.push({ key, legacyKey: legacyKey && !takenLegacyKeys.has(legacyKey) ? legacyKey : null, values, raw, row: r.row });
  };

  for (const r of rowsWithKey) {
    const task = byKey.get(r.key!);
    if (task?.deletedAt) {
      handled.add(task.id);
      rowsToDelete.push({ row: r.row, task });
      continue;
    }
    if (isEmpty(r.cells.title)) {
      report.skipped.push({ row: r.row, reason: "no task title" });
      if (task) handled.add(task.id); // keep the task as it is
    } else if (task) merge(r, task, r.key!, false);
    else create(r, r.key!, null); // a key we do not know (typed by hand, or from another copy of the app)
  }
  for (const r of rowsWithoutKey) {
    if (isEmpty(r.cells.title)) {
      report.skipped.push({ row: r.row, reason: "no task title" });
      continue;
    }
    const legacy = legacyByRow.get(r.row)!;
    const task = legacyCandidates.get(legacy);
    if (task && !handled.has(task.id)) {
      legacyCandidates.delete(legacy);
      merge(r, task, task.sheetKey ?? newKey(), true);
    } else {
      const key = newKey();
      create(r, key, legacy);
      writes.push({ range: idRange(r.row), values: [[key]] });
    }
  }

  // Tasks not matched to any row: created in the app and never in the sheet -> appended below the
  // last row; previously in the sheet -> its row was deleted there, so it is flagged (never deleted).
  const appends: { task: Task; key: string; row: number }[] = [];
  const goneFromSheet: Task[] = [];
  let nextRow = height + 2;
  for (const task of allTasks) {
    if (handled.has(task.id) || task.deletedAt || task.kind === "general") continue;
    if (!task.sheetSnapshot && task.source === "app") {
      const key = task.sheetKey ?? newKey();
      const row = nextRow++;
      appends.push({ task, key, row });
      for (const f of FIELDS.filter(writable)) writes.push({ range: cellRange(f, row), values: [[cellText[f](task[f])]] });
      writes.push({ range: idRange(row), values: [[key]] });
    } else if (task.inSheet) {
      goneFromSheet.push(task);
    }
  }

  // ---- 1. Database first: keys, new tasks, changes from the sheet ----
  await db.transaction(async (tx) => {
    for (const c of creates) {
      const [created] = await tx
        .insert(tasks)
        .values({ ...c.values, ...c.raw, source: SHEET_SOURCE, sheetKey: c.key, sourceKey: c.legacyKey, sheetSnapshot: c.values })
        .returning({ id: tasks.id });
      await tx.insert(taskEvents).values({ taskId: created.id, actorId, source: "sheet_sync", kind: "created", newValue: `Imported from sheet row ${c.row}` });
      report.created.push({ row: c.row, title: c.values.title });
    }
    for (const u of updates) {
      await tx.update(tasks).set(u.set).where(eq(tasks.id, u.taskId));
      if (u.events.length) await tx.insert(taskEvents).values(u.events);
    }
    for (const a of appends) if (!a.task.sheetKey) await tx.update(tasks).set({ sheetKey: a.key }).where(eq(tasks.id, a.task.id));
    if (goneFromSheet.length) {
      await tx.update(tasks).set({ inSheet: false }).where(inArray(tasks.id, goneFromSheet.map((t) => t.id)));
      report.noLongerInSheet.push(...goneFromSheet.map((t) => ({ title: t.title })));
    }
  });

  // ---- 2. The sheet: one request with every cell we change, then rows of deleted tasks (last, so
  // the row numbers above stay valid) ----
  await tab.writeMany(writes);
  await tab.deleteRows(rowsToDelete.map((d) => d.row));

  // ---- 3. Database again: record what the sheet now holds ----
  await db.transaction(async (tx) => {
    for (const [id, set] of afterWrite) await tx.update(tasks).set(set).where(eq(tasks.id, id));
    if (rowsToDelete.length) {
      await tx.update(tasks).set({ inSheet: false }).where(inArray(tasks.id, rowsToDelete.map((d) => d.task.id)));
      report.removedFromSheet.push(...rowsToDelete.map((d) => ({ title: d.task.title })));
    }
    for (const a of appends) {
      await tx
        .update(tasks)
        .set({ sheetSnapshot: pick(a.task), sheetRow: a.row, inSheet: true })
        .where(and(eq(tasks.id, a.task.id), isNull(tasks.sheetSnapshot)));
      report.appended.push({ row: a.row, title: a.task.title });
    }
  });
  return report;
}

/**
 * Runs a sync unless one is already running or (without `force`) the last one finished less than
 * `minIntervalSeconds` ago. Never throws; the outcome is stored for the tasks pages.
 */
export async function runTasksSync({
  actorId = null,
  force = false,
  minIntervalSeconds = AUTO_SYNC_SECONDS,
  api,
  sheetId,
}: { actorId?: number | null; force?: boolean; minIntervalSeconds?: number; api?: SheetsApi; sheetId?: string } = {}): Promise<{
  ran: boolean;
  report?: SyncReport;
}> {
  if (!(await acquireSync(TASKS_SYNC, { minIntervalSeconds, force }))) return { ran: false };
  let report: SyncReport;
  try {
    report = await syncTasks({ actorId, api, sheetId });
  } catch (err) {
    report = { ...emptyReport(), ok: false, error: describeGoogleError(err), tab: tasksSheetTab() };
    console.error("[tasks sheet]", report.error);
  }
  try {
    await db.insert(taskSyncs).values({ actorId, ok: report.ok, report });
  } finally {
    await finishSync(TASKS_SYNC, { ok: report.ok, error: report.error });
  }
  return { ran: true, report };
}

/** For after(): page loads and logins. Never throws. */
export async function runTasksSyncQuietly(): Promise<void> {
  try {
    await runTasksSync();
  } catch (err) {
    console.error("[tasks sheet]", describeGoogleError(err));
  }
}
