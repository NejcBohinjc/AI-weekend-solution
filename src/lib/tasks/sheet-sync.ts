// Imports tasks from the Google Sheet into the database. Idempotent: each sheet row has a stable key
// (see buildRowKeys), existing tasks are updated in place, and fields an admin edited in the app
// (tasks.locked_fields) are never overwritten.
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, taskEvents, tasks, taskSyncs, type Task } from "@/db/schema";
import { STATUS_LABELS, type TaskStatus } from "./constants";
import type { SheetData, SheetRow } from "./google-sheets";
import {
  buildRowKeys,
  mapStatus,
  matchAssignee,
  normalizeType,
  parseDeadline,
  todayInLjubljana,
  type Cell,
  type MemberRef,
} from "./sheet-mapping";

export const SHEET_SOURCE = "gsheet";

type RowRef = { row: number; title: string };
export type SyncReport = {
  ok: boolean;
  error?: string;
  tab?: string;
  at: string;
  rowsRead: number;
  created: RowRef[];
  updated: (RowRef & { fields: string[] })[];
  unchanged: number;
  skipped: { row: number; reason: string }[];
  unassigned: (RowRef & { raw: string; reason: string })[];
  warnings: (RowRef & { message: string })[];
  keptAdminEdits: (RowRef & { fields: string[] })[];
  noLongerInSheet: { title: string }[];
  missingColumns: string[];
};

type SyncedField = "title" | "status" | "assigneeId" | "type" | "dueDate";
const SYNCED_FIELDS: SyncedField[] = ["title", "status", "assigneeId", "type", "dueDate"];

const isEmpty = (c: Cell) => c === undefined || c === null || String(c).trim() === "";
const rawText = (c: Cell) => (isEmpty(c) ? null : String(c).trim());

export function emptyReport(at = new Date()): SyncReport {
  return {
    ok: true,
    at: at.toISOString(),
    rowsRead: 0,
    created: [],
    updated: [],
    unchanged: 0,
    skipped: [],
    unassigned: [],
    warnings: [],
    keptAdminEdits: [],
    noLongerInSheet: [],
    missingColumns: [],
  };
}

/** Saves a failed run (e.g. missing configuration) so admins can see what happened. */
export async function recordFailedSync(error: string, actorId: number | null): Promise<SyncReport> {
  const report = { ...emptyReport(), ok: false, error };
  await db.insert(taskSyncs).values({ actorId, ok: false, report });
  return report;
}

export async function syncTasksFromSheet(
  data: SheetData,
  { actorId, today = todayInLjubljana() }: { actorId: number | null; today?: string },
): Promise<SyncReport> {
  const report = emptyReport();
  report.tab = data.tab;
  report.missingColumns = data.missingColumns;

  const memberRefs: MemberRef[] = await db
    .select({ id: members.id, name: members.name, email: members.email })
    .from(members)
    .where(eq(members.active, true));
  const memberName = new Map(memberRefs.map((m) => [m.id, m.name]));
  const display: Record<SyncedField, (v: unknown) => string | null> = {
    title: (v) => (v as string) ?? null,
    status: (v) => (v ? STATUS_LABELS[v as TaskStatus] : null),
    assigneeId: (v) => (v ? (memberName.get(v as number) ?? `#${v}`) : null),
    type: (v) => (v as string) ?? null,
    dueDate: (v) => (v as string) ?? null,
  };

  // Rows without any value are ignored; rows with values but no title are reported.
  const rows: (SheetRow & { title: string })[] = [];
  for (const row of data.rows) {
    const cells = [row.title, row.status, row.assignee, row.type, row.deadline];
    if (cells.every(isEmpty)) continue;
    report.rowsRead++;
    if (isEmpty(row.title)) report.skipped.push({ row: row.rowNumber, reason: "no task title" });
    else rows.push({ ...row, title: String(row.title).replace(/\s+/g, " ").trim() });
  }
  const keys = buildRowKeys(rows.map((r) => r.title));

  await db.transaction(async (tx) => {
    // One sync at a time, so two admins clicking at once cannot create duplicates.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('task_sheet_sync'))`);
    const existing = await tx.select().from(tasks).where(eq(tasks.source, SHEET_SOURCE));
    const byKey = new Map(existing.map((t) => [t.sourceKey, t]));
    const seenKeys = new Set<string>();

    for (const [i, row] of rows.entries()) {
      const key = keys[i];
      seenKeys.add(key);
      const ref = { row: row.rowNumber, title: row.title };

      const status = mapStatus(row.status);
      if (!status.recognised) report.warnings.push({ ...ref, message: `unknown status "${rawText(row.status)}", imported as To do` });
      const task = byKey.get(key);
      const assignee = matchAssignee(row.assignee, memberRefs);
      // An admin who already set the assignee in the app has resolved it; don't report it again.
      if (assignee.reason && !task?.lockedFields.includes("assigneeId")) {
        report.unassigned.push({ ...ref, raw: rawText(row.assignee)!, reason: assignee.reason });
      }
      const deadline = parseDeadline(row.deadline, today);
      if (deadline.error) report.warnings.push({ ...ref, message: `deadline "${rawText(row.deadline)}" ${deadline.error}, left empty` });

      const values: Record<SyncedField, unknown> = {
        title: row.title,
        status: status.status,
        assigneeId: assignee.memberId,
        type: normalizeType(row.type),
        dueDate: deadline.date,
      };
      const raw = {
        statusRaw: rawText(row.status),
        assigneeRaw: rawText(row.assignee),
        typeRaw: rawText(row.type),
        deadlineRaw: rawText(row.deadline),
        sheetRow: row.rowNumber,
        inSheet: true,
      };

      if (!task) {
        const [created] = await tx
          .insert(tasks)
          .values({ ...(values as Pick<Task, SyncedField>), ...raw, source: SHEET_SOURCE, sourceKey: key })
          .returning({ id: tasks.id });
        await tx.insert(taskEvents).values({
          taskId: created.id,
          actorId,
          source: "sheet_sync",
          kind: "created",
          newValue: `Imported from sheet row ${row.rowNumber}`,
        });
        report.created.push(ref);
        continue;
      }

      const changed: Partial<Record<SyncedField, unknown>> = {};
      const kept: string[] = [];
      for (const field of SYNCED_FIELDS) {
        if (task[field] === values[field]) continue;
        if (task.lockedFields.includes(field)) kept.push(field);
        else changed[field] = values[field];
      }
      if (kept.length) report.keptAdminEdits.push({ ...ref, fields: kept });

      await tx
        .update(tasks)
        .set({ ...(changed as Partial<Task>), ...raw, ...(Object.keys(changed).length && { updatedAt: new Date() }) })
        .where(eq(tasks.id, task.id));
      const changedFields = Object.keys(changed) as SyncedField[];
      if (changedFields.length) {
        await tx.insert(taskEvents).values(
          changedFields.map((field) => ({
            taskId: task.id,
            actorId,
            source: "sheet_sync" as const,
            kind: "updated" as const,
            field,
            oldValue: display[field](task[field]),
            newValue: display[field](changed[field]),
          })),
        );
        report.updated.push({ ...ref, fields: changedFields });
      } else {
        report.unchanged++;
      }
    }

    // Imported tasks whose row disappeared are kept (with their history) but flagged.
    for (const task of existing) {
      if (task.inSheet && task.sourceKey && !seenKeys.has(task.sourceKey)) {
        await tx.update(tasks).set({ inSheet: false }).where(eq(tasks.id, task.id));
        report.noLongerInSheet.push({ title: task.title });
      }
    }

    await tx.insert(taskSyncs).values({ actorId, ok: true, report });
  });

  return report;
}
