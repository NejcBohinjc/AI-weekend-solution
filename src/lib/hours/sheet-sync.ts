// Mirrors finished time entries to the "Ure dela" tab of the Google Sheet, via the service account.
// The database is the source of truth; the sheet is a record for people to read. Every row carries the
// entry id in column F, so an edit updates the right row even after someone sorts the sheet, and a retry
// never adds a duplicate. Only the hours tab is ever written; the tasks tab stays read-only (lib/tasks).
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { JWT } from "google-auth-library";
import { db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { sheetRow } from "./time";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const HEADER = ["oseba", "dan začetka", "ura začetka", "dan konca", "ura konca", "id"];
const BATCH = 100;

export class HoursSheetConfigError extends Error {}

function config() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Env vars usually hold the key with literal "\n"; turn them back into newlines.
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const tab = process.env.GOOGLE_SHEET_HOURS_TAB || "Ure dela";
  const missing = [
    !sheetId && "GOOGLE_SHEET_ID",
    !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    !key && "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length) throw new HoursSheetConfigError(`Google Sheets is not configured. Missing: ${missing.join(", ")}.`);
  return { sheetId: sheetId!, email: email!, key: key!, tab };
}

export function hoursSheetTab(): string {
  return process.env.GOOGLE_SHEET_HOURS_TAB || "Ure dela";
}

// One client per process: it caches its access token between requests.
let cachedClient: { email: string; client: JWT } | null = null;
function client(email: string, key: string): JWT {
  if (cachedClient?.email !== email) cachedClient = { email, client: new JWT({ email, key, scopes: [SCOPE] }) };
  return cachedClient.client;
}

/** Every request goes through this class, and every range it builds is inside the hours tab. */
class HoursTab {
  private gid: number | null = null;

  constructor(
    private readonly api: JWT,
    private readonly sheetId: string,
    private readonly tab: string,
  ) {}

  private get base() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.sheetId)}`;
  }

  private range(a1: string) {
    return encodeURIComponent(`'${this.tab.replace(/'/g, "''")}'!${a1}`);
  }

  /** Writes the header if the tab is empty, or just "id" in F1 if only that is missing. */
  async ensureHeader(): Promise<void> {
    const res = await this.api.request<{ values?: string[][] }>({ url: `${this.base}/values/${this.range("A1:F1")}` });
    const row = res.data.values?.[0] ?? [];
    if (!row[0]) await this.write("A1:F1", [HEADER]);
    else if (!row[5]) await this.write("F1", [["id"]]);
  }

  /** Entry id -> row number, from column F. */
  async rowsById(): Promise<Map<number, number>> {
    const res = await this.api.request<{ values?: unknown[][] }>({
      url: `${this.base}/values/${this.range("F:F")}?valueRenderOption=UNFORMATTED_VALUE`,
    });
    const rows = new Map<number, number>();
    (res.data.values ?? []).forEach((cells, i) => {
      const id = Number(cells[0]);
      if (i > 0 && Number.isInteger(id) && id > 0 && !rows.has(id)) rows.set(id, i + 1);
    });
    return rows;
  }

  private async write(a1: string, values: unknown[][]): Promise<void> {
    await this.api.request({
      url: `${this.base}/values/${this.range(a1)}?valueInputOption=USER_ENTERED`,
      method: "PUT",
      data: { values },
    });
  }

  async update(row: number, values: unknown[]): Promise<void> {
    await this.write(`A${row}:F${row}`, [values]);
  }

  /** Adds a row under the last one and returns its row number. */
  async append(values: unknown[]): Promise<number | null> {
    const res = await this.api.request<{ updates?: { updatedRange?: string } }>({
      url: `${this.base}/values/${this.range("A:F")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      method: "POST",
      data: { values: [values] },
    });
    const m = res.data.updates?.updatedRange?.match(/![A-Z]+(\d+)/);
    return m ? Number(m[1]) : null;
  }

  async deleteRow(row: number): Promise<void> {
    if (this.gid === null) {
      const res = await this.api.request<{ sheets: { properties: { sheetId: number; title: string } }[] }>({
        url: `${this.base}?fields=sheets.properties(sheetId,title)`,
      });
      const tab = res.data.sheets.find((s) => s.properties.title === this.tab);
      if (!tab) throw new Error(`Tab "${this.tab}" not found`);
      this.gid = tab.properties.sheetId;
    }
    await this.api.request({
      url: `${this.base}:batchUpdate`,
      method: "POST",
      data: { requests: [{ deleteDimension: { range: { sheetId: this.gid, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }] },
    });
  }
}

export type HoursSheetResult = { ok: boolean; synced: number; failed: number; error?: string };

/** Google client errors carry request headers (with the access token), so only the message is kept. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

/**
 * Brings the sheet in line with every entry marked pending: a finished entry is written to its row
 * (found by id in column F) or appended; a deleted entry has its row removed. Idempotent. Runs one
 * at a time, so two stops at once cannot race on row numbers.
 */
export async function syncHoursSheet(): Promise<HoursSheetResult> {
  let cfg: ReturnType<typeof config>;
  try {
    cfg = config();
  } catch (err) {
    return { ok: false, synced: 0, failed: 0, error: errorMessage(err) };
  }
  const tab = new HoursTab(client(cfg.email, cfg.key), cfg.sheetId, cfg.tab);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hours_sheet_sync'))`);
    const pending = await tx
      .select({ entry: timeEntries, name: members.name })
      .from(timeEntries)
      .innerJoin(members, eq(timeEntries.memberId, members.id))
      .where(and(eq(timeEntries.sheetStatus, "pending"), or(isNotNull(timeEntries.endedAt), isNotNull(timeEntries.deletedAt))))
      .orderBy(asc(timeEntries.id))
      .limit(BATCH);
    if (!pending.length) return { ok: true, synced: 0, failed: 0 };

    let rows: Map<number, number>;
    try {
      await tab.ensureHeader();
      rows = await tab.rowsById();
    } catch (err) {
      const error = `Could not reach the "${cfg.tab}" tab: ${errorMessage(err)}`;
      console.error("[hours sheet]", error);
      return { ok: false, synced: 0, failed: pending.length, error };
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
            rows = await tab.rowsById(); // rows below moved up
          }
        } else if (entry.endedAt) {
          const values = sheetRow(name, entry.startedAt, entry.endedAt, entry.id);
          if (row) await tab.update(row, values);
          else {
            const appended = await tab.append(values);
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
        lastError = errorMessage(err);
        console.error("[hours sheet] entry", entry.id, lastError);
        await tx.update(timeEntries).set({ sheetError: lastError }).where(eq(timeEntries.id, entry.id));
        failed++;
      }
    }
    return { ok: failed === 0, synced, failed, error: lastError };
  });
}

/** For after(): never throws, so a Google outage cannot break the page that triggered it. */
export async function syncHoursSheetQuietly(): Promise<void> {
  try {
    const result = await syncHoursSheet();
    if (!result.ok && result.error) console.error("[hours sheet]", result.error);
  } catch (err) {
    console.error("[hours sheet]", errorMessage(err));
  }
}
