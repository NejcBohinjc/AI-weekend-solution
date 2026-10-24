// Read-only access to the tasks tab in Google Sheets, via a service account.
// Only the header row and the five mapped columns are fetched, so other columns
// (for example a password column) are never read. Nothing is ever written to the sheet.
import { JWT } from "google-auth-library";
import { findColumns, type Cell, type SheetField } from "./sheet-mapping";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type SheetRow = { rowNumber: number } & Record<SheetField, Cell>;
export type SheetData = { tab: string; rows: SheetRow[]; missingColumns: SheetField[] };

export class SheetConfigError extends Error {}

function config() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Env vars usually hold the key with literal "\n"; turn them back into newlines.
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const tab = process.env.GOOGLE_SHEET_TASKS_TAB || "List1";
  const missing = [
    !sheetId && "GOOGLE_SHEET_ID",
    !email && "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    !key && "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length) throw new SheetConfigError(`Google Sheets is not configured. Missing: ${missing.join(", ")}.`);
  return { sheetId: sheetId!, email: email!, key: key!, tab };
}

/** A1 column letter for a 0-based index: 0 -> A, 26 -> AA. */
function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

export async function readTasksSheet(): Promise<SheetData> {
  const { sheetId, email, key, tab } = config();
  const client = new JWT({ email, key, scopes: [SCOPE] });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values`;

  // 1. Header row only.
  const header = await client.request<{ values?: Cell[][] }>({
    url: `${base}/${encodeURIComponent(`${quoteTab(tab)}!1:1`)}`,
  });
  const { columns, missing } = findColumns(header.data.values?.[0] ?? []);
  if (columns.title === undefined) {
    throw new SheetConfigError(`Tab "${tab}" has no "task" column in its first row.`);
  }

  // 2. Only the mapped columns, from row 2 down. Unformatted, so date cells arrive as serial numbers.
  const fields = Object.keys(columns) as SheetField[];
  const params = new URLSearchParams({ majorDimension: "COLUMNS", valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  for (const field of fields) {
    const col = columnLetter(columns[field]!);
    params.append("ranges", `${quoteTab(tab)}!${col}2:${col}`);
  }
  const res = await client.request<{ valueRanges?: { values?: Cell[][] }[] }>({ url: `${base}:batchGet?${params}` });
  const columnValues = new Map(fields.map((field, i) => [field, res.data.valueRanges?.[i]?.values?.[0] ?? []]));

  const height = Math.max(0, ...[...columnValues.values()].map((v) => v.length));
  const rows: SheetRow[] = [];
  for (let i = 0; i < height; i++) {
    const cell = (f: SheetField) => columnValues.get(f)?.[i];
    rows.push({
      rowNumber: i + 2,
      title: cell("title"),
      status: cell("status"),
      assignee: cell("assignee"),
      type: cell("type"),
      deadline: cell("deadline"),
    });
  }
  return { tab, rows, missingColumns: missing };
}
