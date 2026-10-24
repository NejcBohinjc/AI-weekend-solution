// Mirrors finished time entries to the "Ure dela" tab of the Google Sheet, via the service account.
// The database is the source of truth; the sheet is a record for people to read. Every row carries the
// entry id in column F, so an edit updates the right row even after someone sorts the sheet, and a retry
// never adds a duplicate. This module only ever opens the hours tab.
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { describeGoogleError, openTab, type SheetsApi, type SheetTab } from "@/lib/google/sheets";
import { recordSyncResult } from "@/lib/sync-state";
import { sheetRow } from "./time";

const HEADER = ["oseba", "dan začetka", "ura začetka", "dan konca", "ura konca", "id"];
const BATCH = 100;
export const HOURS_SYNC = "hours_sheet";

export function hoursSheetTab(): string {
  return process.env.GOOGLE_SHEET_HOURS_TAB || "Ure dela";
}

/** Creates the tab with its header if it is missing; adds the header or just "id" in F1 if absent. */
async function ensureHeader(tab: SheetTab): Promise<void> {
  if (await tab.ensureExists(HEADER)) return;
  const row = (await tab.get("A1:F1"))[0] ?? [];
  if (!row[0]) await tab.write("A1:F1", [HEADER]);
  else if (!row[5]) await tab.write("F1", [["id"]]);
}

/** Entry id -> row number, from column F. */
async function rowsById(tab: SheetTab): Promise<Map<number, number>> {
  const rows = new Map<number, number>();
  (await tab.get("F:F", true)).forEach((cells, i) => {
    const id = Number(cells[0]);
    if (i > 0 && Number.isInteger(id) && id > 0 && !rows.has(id)) rows.set(id, i + 1);
  });
  return rows;
}

export type HoursSheetResult = { ok: boolean; synced: number; failed: number; error?: string; fatal?: boolean };

const pendingWhere = and(eq(timeEntries.sheetStatus, "pending"), or(isNotNull(timeEntries.endedAt), isNotNull(timeEntries.deletedAt)));

/** A failure that stops the whole run: shown on every waiting entry and on the admin page. */
async function failRun(error: string, pending: number): Promise<HoursSheetResult> {
  console.error("[hours sheet]", error);
  await db.update(timeEntries).set({ sheetError: error }).where(pendingWhere);
  await recordSyncResult(HOURS_SYNC, { ok: false, error });
  return { ok: false, synced: 0, failed: pending, error };
}

/**
 * Brings the sheet in line with every entry marked pending: a finished entry is written to its row
 * (found by id in column F) or appended; a deleted entry has its row removed. Idempotent. Runs one
 * at a time, so two stops at once cannot race on row numbers.
 */
export async function syncHoursSheet(opts: { api?: SheetsApi; sheetId?: string } = {}): Promise<HoursSheetResult> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hours_sheet_sync'))`);
    const pending = await tx
      .select({ entry: timeEntries, name: members.name })
      .from(timeEntries)
      .innerJoin(members, eq(timeEntries.memberId, members.id))
      .where(pendingWhere)
      .orderBy(asc(timeEntries.id))
      .limit(BATCH);
    if (!pending.length) return { ok: true, synced: 0, failed: 0 } as HoursSheetResult;

    let tab: SheetTab;
    let rows: Map<number, number>;
    try {
      tab = openTab(hoursSheetTab(), opts.api, opts.sheetId);
      await ensureHeader(tab);
      rows = await rowsById(tab);
    } catch (err) {
      return { ok: false, synced: 0, failed: pending.length, error: `Could not reach the "${hoursSheetTab()}" tab: ${describeGoogleError(err)}`, fatal: true };
    }

    let synced = 0;
    let failed = 0;
    let lastError: string | undefined;
    for (const { entry, name } of pending) {
      try {
        const row = rows.get(entry.id);
        if (entry.deletedAt) {
          if (row) {
            await tab.deleteRow(row);
            rows = await rowsById(tab); // rows below moved up
          }
        } else if (entry.endedAt) {
          const values = sheetRow(name, entry.startedAt, entry.endedAt, entry.id);
          if (row) await tab.write(`A${row}:F${row}`, [values]);
          else {
            const appended = await tab.append("A:F", values);
            if (appended) rows.set(entry.id, appended);
          }
        }
        // Only if nobody changed the entry meanwhile; otherwise it stays pending for the next run.
        // (Postgres keeps microseconds, JavaScript dates milliseconds.)
        await tx
          .update(timeEntries)
          .set({ sheetStatus: "synced", sheetError: null, sheetSyncedAt: new Date() })
          .where(and(eq(timeEntries.id, entry.id), sql`date_trunc('milliseconds', ${timeEntries.updatedAt}) = ${entry.updatedAt.toISOString()}`));
        synced++;
      } catch (err) {
        lastError = describeGoogleError(err);
        console.error("[hours sheet] entry", entry.id, lastError);
        await tx.update(timeEntries).set({ sheetError: lastError }).where(eq(timeEntries.id, entry.id));
        failed++;
      }
    }
    return { ok: failed === 0, synced, failed, error: lastError } as HoursSheetResult;
  });

  if (result.fatal) return failRun(result.error!, result.failed);
  if (result.synced || result.failed) await recordSyncResult(HOURS_SYNC, { ok: result.ok, error: result.error });
  return result;
}

/** For after(): never throws, so a Google outage cannot break the page that triggered it. */
export async function syncHoursSheetQuietly(): Promise<void> {
  try {
    const result = await syncHoursSheet();
    if (!result.ok && result.error) console.error("[hours sheet]", result.error);
  } catch (err) {
    console.error("[hours sheet]", describeGoogleError(err));
  }
}
