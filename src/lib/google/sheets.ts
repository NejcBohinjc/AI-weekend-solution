// Google Sheets access via the service account, shared by the hours and tasks syncs.
// Every read and write goes through a SheetTab, which is bound to one tab: code that holds the
// tasks tab cannot touch any other tab (in particular never the Users tab).
import { JWT } from "google-auth-library";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export type Cell = string | number | boolean | null | undefined;
export type SheetsRequest = { url: string; method?: "GET" | "PUT" | "POST"; data?: unknown };
/** The one call we need from google-auth-library's JWT client; tests pass an in-memory fake. */
export interface SheetsApi {
  request<T>(opts: SheetsRequest): Promise<{ data: T }>;
}

export class SheetsConfigError extends Error {}

export function sheetsConfig() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Env vars usually hold the key with literal "\n"; turn them back into newlines.
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const missing = [
    !sheetId && "GOOGLE_SHEET_ID",
    !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    !key && "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length) throw new SheetsConfigError(`Google Sheets is not configured. Missing: ${missing.join(", ")}.`);
  return { sheetId: sheetId!, email: email!, key: key! };
}

// One client per process: it caches its access token between requests.
let cached: { email: string; client: JWT } | null = null;
export function sheetsApi(): SheetsApi {
  const { email, key } = sheetsConfig();
  if (cached?.email !== email) cached = { email, client: new JWT({ email, key, scopes: [SCOPE] }) };
  return cached.client;
}

/**
 * The exact Google error, e.g. "403 PERMISSION_DENIED: The caller does not have permission".
 * Never the whole error object: Google client errors carry request headers with the access token.
 */
export function describeGoogleError(err: unknown): string {
  if (err instanceof SheetsConfigError) return err.message;
  const res = (err as { response?: { status?: number; data?: unknown } })?.response;
  if (res) {
    const data = res.data as { error?: { status?: string; message?: string } | string; error_description?: string } | undefined;
    if (data && typeof data.error === "object") return `${res.status} ${data.error.status ?? ""}: ${data.error.message ?? ""}`.trim();
    if (data && typeof data.error === "string") return `${res.status} ${data.error}: ${data.error_description ?? ""}`.trim();
    return `HTTP ${res.status}`;
  }
  return err instanceof Error ? err.message : "unknown error";
}

/** Text that Sheets must not treat as a formula (a title like "=IMPORTXML(...)"). */
export function plainText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** A1 column letter for a 0-based index: 0 -> A, 26 -> AA. */
export function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export class SheetTab {
  private gid: number | null = null;

  constructor(
    private readonly api: SheetsApi,
    private readonly sheetId: string,
    readonly tab: string,
  ) {}

  private get base() {
    return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.sheetId)}`;
  }

  /** Every range is prefixed with this tab. */
  private a1(range: string) {
    return `'${this.tab.replace(/'/g, "''")}'!${range}`;
  }

  async get(range: string, unformatted = false): Promise<Cell[][]> {
    const q = unformatted ? "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER" : "";
    const res = await this.api.request<{ values?: Cell[][] }>({ url: `${this.base}/values/${encodeURIComponent(this.a1(range))}${q}` });
    return res.data.values ?? [];
  }

  /** Several ranges at once, each as a list of columns (unformatted: dates come as serial numbers). */
  async getColumns(ranges: string[]): Promise<Cell[][]> {
    const params = new URLSearchParams({ majorDimension: "COLUMNS", valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
    for (const r of ranges) params.append("ranges", this.a1(r));
    const res = await this.api.request<{ valueRanges?: { values?: Cell[][] }[] }>({ url: `${this.base}/values:batchGet?${params}` });
    return ranges.map((_, i) => res.data.valueRanges?.[i]?.values?.[0] ?? []);
  }

  async write(range: string, values: Cell[][]): Promise<void> {
    await this.api.request({
      url: `${this.base}/values/${encodeURIComponent(this.a1(range))}?valueInputOption=USER_ENTERED`,
      method: "PUT",
      data: { values },
    });
  }

  /** Many single ranges in one request. */
  async writeMany(updates: { range: string; values: Cell[][] }[]): Promise<void> {
    if (!updates.length) return;
    await this.api.request({
      url: `${this.base}/values:batchUpdate`,
      method: "POST",
      data: { valueInputOption: "USER_ENTERED", data: updates.map((u) => ({ range: this.a1(u.range), values: u.values })) },
    });
  }

  /** Adds a row under the last one in `range` and returns its row number. */
  async append(range: string, values: Cell[]): Promise<number | null> {
    const res = await this.api.request<{ updates?: { updatedRange?: string } }>({
      url: `${this.base}/values/${encodeURIComponent(this.a1(range))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      method: "POST",
      data: { values: [values] },
    });
    const m = res.data.updates?.updatedRange?.match(/![A-Z]+(\d+)/);
    return m ? Number(m[1]) : null;
  }

  /** The tab's numeric id, or null if the tab does not exist. Reads tab names only, no cells. */
  private async findGid(): Promise<number | null> {
    if (this.gid !== null) return this.gid;
    const res = await this.api.request<{ sheets?: { properties: { sheetId: number; title: string } }[] }>({
      url: `${this.base}?fields=sheets.properties(sheetId,title)`,
    });
    const found = res.data.sheets?.find((s) => s.properties.title === this.tab);
    this.gid = found ? found.properties.sheetId : null;
    return this.gid;
  }

  /** Creates the tab (with `header` in row 1) if it does not exist. Returns true if it was created. */
  async ensureExists(header?: string[]): Promise<boolean> {
    if ((await this.findGid()) !== null) return false;
    const res = await this.api.request<{ replies?: { addSheet?: { properties?: { sheetId: number } } }[] }>({
      url: `${this.base}:batchUpdate`,
      method: "POST",
      data: { requests: [{ addSheet: { properties: { title: this.tab } } }] },
    });
    this.gid = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
    if (header) await this.write(`A1:${columnLetter(header.length - 1)}1`, [header]);
    return true;
  }

  async deleteRow(row: number): Promise<void> {
    const gid = await this.findGid();
    if (gid === null) throw new Error(`Tab "${this.tab}" not found`);
    await this.api.request({
      url: `${this.base}:batchUpdate`,
      method: "POST",
      data: { requests: [{ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: row - 1, endIndex: row } } }] },
    });
  }
}

/** The tab `tab` of the configured spreadsheet, or of a test fake. */
export function openTab(tab: string, api?: SheetsApi, sheetId?: string): SheetTab {
  return new SheetTab(api ?? sheetsApi(), sheetId ?? sheetsConfig().sheetId, tab);
}
