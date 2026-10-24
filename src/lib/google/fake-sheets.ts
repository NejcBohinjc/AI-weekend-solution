// In-memory stand-in for the Google Sheets REST API, for tests. Implements exactly the calls
// SheetTab makes, and records every range read or written so tests can assert what was touched.
import type { Cell, SheetsApi, SheetsRequest } from "./sheets";

type Grid = Cell[][];
const empty = (c: Cell) => c === undefined || c === null || c === "";

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "'Tab'!A2:F" -> tab and 0-based inclusive bounds (Infinity when open-ended). */
export function parseA1(range: string) {
  const m = range.match(/^'((?:[^']|'')+)'!(.+)$/);
  if (!m) throw new Error(`bad range ${range}`);
  const tab = m[1].replace(/''/g, "'");
  const [a, b = a] = m[2].split(":");
  const pa = a.match(/^([A-Z]*)(\d*)$/)!;
  const pb = b.match(/^([A-Z]*)(\d*)$/)!;
  return {
    tab,
    c0: pa[1] ? colIndex(pa[1]) : 0,
    r0: pa[2] ? Number(pa[2]) - 1 : 0,
    c1: pb[1] ? colIndex(pb[1]) : pa[1] && !pa[2] ? colIndex(pa[1]) : Infinity,
    r1: pb[2] ? Number(pb[2]) - 1 : Infinity,
  };
}

function googleError(status: number, code: string, message: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error: { code: status, status: code, message } } },
  });
}

export class FakeSheets implements SheetsApi {
  tabs = new Map<string, { gid: number; grid: Grid }>();
  reads: string[] = [];
  writes: string[] = [];
  /** Makes every request fail, e.g. { status: 403, code: "PERMISSION_DENIED", message: "..." }. */
  failWith: { status: number; code: string; message: string } | null = null;
  private nextGid = 100;

  constructor(tabs: Record<string, Grid> = {}) {
    for (const [title, grid] of Object.entries(tabs)) this.addTab(title, grid);
  }

  addTab(title: string, grid: Grid = []) {
    this.tabs.set(title, { gid: this.nextGid++, grid: grid.map((r) => [...r]) });
  }

  /** The tab as rows, trailing empty cells and rows removed. */
  rows(title: string): Grid {
    return trim(this.tabs.get(title)?.grid ?? []);
  }

  private tab(name: string, range: string) {
    const t = this.tabs.get(name);
    if (!t) throw googleError(400, "INVALID_ARGUMENT", `Unable to parse range: ${range}`);
    return t;
  }

  private read(range: string): Grid {
    this.reads.push(range);
    const { tab, r0, r1, c0, c1 } = parseA1(range);
    const grid = this.tab(tab, range).grid;
    const out: Grid = [];
    for (let r = r0; r <= Math.min(r1, grid.length - 1); r++) {
      const row = grid[r] ?? [];
      out.push(row.slice(c0, c1 === Infinity ? undefined : c1 + 1));
    }
    return trim(out);
  }

  private put(range: string, values: Grid) {
    this.writes.push(range);
    const { tab, r0, c0 } = parseA1(range);
    const grid = this.tab(tab, range).grid;
    values.forEach((row, i) => {
      grid[r0 + i] ??= [];
      // USER_ENTERED: a leading apostrophe means "store as text".
      row.forEach((v, j) => (grid[r0 + i][c0 + j] = typeof v === "string" && v.startsWith("'") ? v.slice(1) : v));
    });
  }

  async request<T>({ url, method = "GET", data }: SheetsRequest): Promise<{ data: T }> {
    if (this.failWith) throw googleError(this.failWith.status, this.failWith.code, this.failWith.message);
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ""));
    const body = data as Record<string, unknown>;

    if (path === "" && method === "GET") {
      const sheets = [...this.tabs].map(([title, t]) => ({ properties: { sheetId: t.gid, title } }));
      return { data: { sheets } as T };
    }
    if (path === ":batchUpdate") {
      type Req = {
        addSheet?: { properties: { title: string } };
        deleteDimension?: { range: { sheetId: number; startIndex: number; endIndex: number } };
      };
      const replies = (body.requests as Req[]).map((req) => {
        if (req.addSheet) {
          const title = req.addSheet.properties.title;
          if (this.tabs.has(title)) throw googleError(400, "INVALID_ARGUMENT", `A sheet with the name "${title}" already exists.`);
          this.addTab(title);
          return { addSheet: { properties: { sheetId: this.tabs.get(title)!.gid, title } } };
        }
        if (req.deleteDimension) {
          const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
          const t = [...this.tabs.values()].find((x) => x.gid === sheetId)!;
          t.grid.splice(startIndex, endIndex - startIndex);
          return {};
        }
        throw new Error(`fake: unsupported request ${Object.keys(req)}`);
      });
      return { data: { replies } as T };
    }
    if (path === "/values:batchGet") {
      const valueRanges = u.searchParams.getAll("ranges").map((range) => {
        const rows = this.read(range);
        const width = Math.max(0, ...rows.map((r) => r.length));
        const cols = Array.from({ length: width }, (_, c) => trimRow(rows.map((r) => r[c])));
        return { range, values: cols };
      });
      return { data: { valueRanges } as T };
    }
    if (path === "/values:batchUpdate") {
      for (const d of body.data as { range: string; values: Grid }[]) this.put(d.range, d.values);
      return { data: {} as T };
    }
    const m = path.match(/^\/values\/(.+?)(:append)?$/);
    if (m && m[2]) {
      const range = m[1];
      const { tab, c0, c1 } = parseA1(range);
      const grid = this.tab(tab, range).grid;
      let last = -1;
      grid.forEach((row, r) => {
        if (row.slice(c0, c1 === Infinity ? undefined : c1 + 1).some((c) => !empty(c))) last = r;
      });
      const rowNumber = last + 2;
      const letter = range.match(/!([A-Z]+)/)?.[1] ?? "A";
      this.put(`'${tab.replace(/'/g, "''")}'!${letter}${rowNumber}`, body.values as Grid);
      return { data: { updates: { updatedRange: `'${tab}'!${letter}${rowNumber}` } } as T };
    }
    if (m && method === "PUT") {
      this.put(m[1], body.values as Grid);
      return { data: {} as T };
    }
    if (m) return { data: { values: this.read(m[1]) } as T };
    throw new Error(`fake: unsupported ${method} ${url}`);
  }
}

function trimRow(row: Cell[]): Cell[] {
  const out = [...row];
  while (out.length && empty(out[out.length - 1])) out.pop();
  return out.map((c) => (c === undefined || c === null ? "" : c));
}

function trim(grid: Grid): Grid {
  const out = grid.map(trimRow);
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}
