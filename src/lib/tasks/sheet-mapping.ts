// Pure mapping from Google Sheets cell values to task fields. No I/O, so it is unit-tested.
import { TIMEZONE } from "@/lib/app";
import { TASK_TYPES, type TaskPriority, type TaskStatus } from "./constants";

export type Cell = string | number | boolean | undefined | null;

/** Lowercase, no diacritics, single spaces. Used for headers, statuses, names and row keys. */
export function normalizeText(value: Cell): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Headers ----------

export type SheetField = "title" | "status" | "assignee" | "type" | "deadline" | "priority";

// Header names as they appear in the sheet (compared after normalizeText).
const HEADERS: Record<SheetField, string[]> = {
  title: ["task"],
  status: ["status"],
  assignee: ["nosilec"],
  type: ["tip taska"],
  deadline: ["deadline"],
  priority: ["priority", "prioriteta", "prio", "nujnost"],
};

/** The header the sync writes when the sheet has no priority column yet. */
export const PRIORITY_HEADER = "priority";

/** Finds each field's column index in the header row. Only these columns are ever read. */
export function findColumns(headerRow: Cell[]): { columns: Partial<Record<SheetField, number>>; missing: SheetField[] } {
  const normalized = headerRow.map(normalizeText);
  const columns: Partial<Record<SheetField, number>> = {};
  const missing: SheetField[] = [];
  for (const field of Object.keys(HEADERS) as SheetField[]) {
    const index = normalized.findIndex((h) => HEADERS[field].includes(h));
    if (index >= 0) columns[field] = index;
    else missing.push(field);
  }
  return { columns, missing };
}

/** The "id" column the two-way sync keeps the task keys in, or -1 if the sheet does not have one yet. */
export function findIdColumn(headerRow: Cell[]): number {
  return headerRow.map(normalizeText).indexOf("id");
}

// ---------- Status ----------

const STATUS_WORDS: Record<TaskStatus, string[]> = {
  todo: [
    "to do", "todo", "open", "new", "not started", "backlog", "planned", "pending", "waiting",
    "za narediti", "narediti", "odprto", "novo", "ni zaceto", "nezaceto", "ni se zaceto", "caka", "na cakanju", "planirano",
  ],
  in_progress: [
    "in progress", "progress", "doing", "wip", "started", "ongoing", "in work", "working", "in review", "review",
    "v delu", "v teku", "v izvajanju", "v procesu", "se dela", "delam", "zaceto", "v pregledu",
  ],
  verification: ["verifikacija", "verification", "v verifikaciji", "za verifikacijo", "verify", "to verify", "to be verified", "za preverjanje", "preverjanje"],
  done: [
    "done", "complete", "completed", "finished", "closed", "resolved",
    "narejeno", "koncano", "zakljuceno", "opravljeno", "dokoncano", "reseno", "izvedeno", "oddano",
  ],
};
const STATUS_LOOKUP = new Map<string, TaskStatus>(
  (Object.entries(STATUS_WORDS) as [TaskStatus, string[]][]).flatMap(([status, words]) => words.map((w) => [w, status])),
);

/** Maps a sheet status. Empty means to-do; anything unrecognised is to-do and flagged. */
export function mapStatus(raw: Cell): { status: TaskStatus; recognised: boolean } {
  const key = normalizeText(raw).replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!key) return { status: "todo", recognised: true };
  const status = STATUS_LOOKUP.get(key) ?? STATUS_LOOKUP.get(key.replace(/ /g, ""));
  return status ? { status, recognised: true } : { status: "todo", recognised: false };
}

const STATUS_TEXT: Record<TaskStatus, string> = { todo: "to do", in_progress: "in progress", verification: "verifikacija", done: "done" };

/** How the app writes a status into the sheet. */
export function formatStatus(status: TaskStatus): string {
  return STATUS_TEXT[status];
}

// ---------- Priority ----------

const PRIORITY_WORDS: Record<TaskPriority, string[]> = {
  urgent: ["urgent", "high", "highest", "critical", "asap", "top", "!", "!!", "!!!", "nujno", "nujna", "nujen", "zelo nujno", "visoka", "visoko", "visok", "kriticno"],
  medium: ["medium", "med", "normal", "normalno", "normalna", "srednja", "srednje", "srednji", "obicajno", "obicajna"],
  low: ["low", "lowest", "minor", "later", "nizka", "nizko", "nizek", "ni nujno", "manj nujno", "kasneje"],
};
const PRIORITY_LOOKUP = new Map<string, TaskPriority>(
  (Object.entries(PRIORITY_WORDS) as [TaskPriority, string[]][]).flatMap(([p, words]) => words.map((w) => [w, p])),
);

/**
 * Maps a sheet priority, also "high"/"nujno"/"srednja"/"nizka" and the like, with or without the word
 * "priority"/"prioriteta". Empty or unrecognised gives null: the app keeps (and writes back) its own.
 */
export function mapPriority(raw: Cell): { priority: TaskPriority | null; recognised: boolean } {
  const key = normalizeText(raw)
    .replace(/[-_/]+/g, " ")
    .replace(/\b(priority|prioriteta|prioriteto|prio)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return { priority: null, recognised: !normalizeText(raw) };
  const priority = PRIORITY_LOOKUP.get(key);
  return priority ? { priority, recognised: true } : { priority: null, recognised: false };
}

/** How the app writes a priority into the sheet: "urgent", "medium" or "low". */
export function formatPriority(priority: TaskPriority): string {
  return priority;
}

// ---------- Assignee ----------

export type MemberRef = { id: number; name: string; email: string };

/** Matches "nosilec" by full name, first name, email or email prefix. Assigns only on exactly one match. */
export function matchAssignee(raw: Cell, members: MemberRef[]): { memberId: number | null; reason?: string } {
  const key = normalizeText(raw);
  if (!key) return { memberId: null };
  const matches = members.filter((m) => {
    const name = normalizeText(m.name);
    const email = normalizeText(m.email);
    return key === name || key === name.split(" ")[0] || key === email || key === email.split("@")[0];
  });
  if (matches.length === 1) return { memberId: matches[0].id };
  if (matches.length === 0) return { memberId: null, reason: "no member matches" };
  return { memberId: null, reason: `matches ${matches.length} members (${matches.map((m) => m.name).join(", ")})` };
}

export type DepartmentRef = { id: number; name: string };

/**
 * "nosilec" names one person or a whole department. A department name (ignoring case and diacritics,
 * with or without the word "department"/"oddelek") makes it a department task; anything else is
 * matched to a member as in matchAssignee.
 */
export function matchOwner(
  raw: Cell,
  members: MemberRef[],
  departments: DepartmentRef[],
): { assigneeId: number | null; departmentId: number | null; reason?: string } {
  const key = normalizeText(raw)
    .replace(/^(oddelek|department)\s+/, "")
    .replace(/\s+(department|oddelek)$/, "");
  if (!key) return { assigneeId: null, departmentId: null };
  const department = departments.find((d) => normalizeText(d.name) === key);
  if (department) return { assigneeId: null, departmentId: department.id };
  const member = matchAssignee(raw, members);
  return { assigneeId: member.memberId, departmentId: null, reason: member.reason };
}

export type AssigneeStyle = "email" | "first" | "full";

/** Writes names the way the sheet already does: emails, first names or full names (by majority). */
export function detectAssigneeStyle(raws: Cell[]): AssigneeStyle {
  const values = raws.map((r) => String(r ?? "").trim()).filter(Boolean);
  const emails = values.filter((v) => v.includes("@")).length;
  const single = values.filter((v) => !v.includes("@") && !v.includes(" ")).length;
  if (emails * 2 > values.length) return "email";
  if (single * 2 > values.length) return "first";
  return "full";
}

/** The sheet text for a member. A first name is used only if it still matches exactly one member. */
export function formatAssignee(member: MemberRef, style: AssigneeStyle, members: MemberRef[]): string {
  if (style === "email") return member.email;
  const first = member.name.split(" ")[0];
  if (style === "first" && matchAssignee(first, members).memberId === member.id) return first;
  return member.name;
}

// ---------- Type ----------

/**
 * A task type: one of TASK_TYPES if it matches ignoring case and diacritics ("marketing " ->
 * "Marketing"), otherwise the value as typed (trimmed). Empty means no type.
 */
export function normalizeType(raw: Cell): string | null {
  const value = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return null;
  return TASK_TYPES.find((t) => normalizeText(t) === normalizeText(value)) ?? value;
}

// ---------- Deadline ----------

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? isoDate(y, m, d) : null;
}

/** Today's date in Europe/Ljubljana as yyyy-mm-dd. */
export function todayInLjubljana(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Parses a deadline into a yyyy-mm-dd date (Europe/Ljubljana).
 * Accepts Sheets date serials, dd.mm.yyyy, dd.mm.yy, d.m. (no year: next upcoming date), yyyy-mm-dd,
 * dd/mm/yyyy, and any of these followed by a time. Empty means no deadline.
 */
export function parseDeadline(raw: Cell, today: string): { date: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === "") return { date: null };

  if (typeof raw === "number") {
    // Sheets serial: days since 1899-12-30; the fraction is the time of day in the sheet's (Ljubljana) time.
    if (!Number.isFinite(raw) || raw < 1) return { date: null, error: "not a date" };
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000);
    // A plain number like 12 is not a deadline; real serials for this decade are around 46000.
    if (dt.getUTCFullYear() < 2000) return { date: null, error: "not a date" };
    return { date: isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) };
  }

  const text = String(raw).trim();
  if (!text) return { date: null };

  // ISO date or local date-time: 2026-11-15, 2026-11-15 14:00, 2026-11-15T14:00
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/);
  if (m) return orError(validDate(+m[1], +m[2], +m[3]));

  // ISO date-time with an explicit zone: convert the instant to a Ljubljana date.
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? { date: null, error: "not a date" } : { date: todayInLjubljana(new Date(ms)) };
  }

  // dd.mm.yyyy, dd. mm. yyyy, dd.mm.yy, d.m., d.m, dd/mm/yyyy, each optionally followed by a time.
  m = text.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})\s*(?:[./]\s*(\d{4}|\d{2})?)?\s*\.?(?:\s+\d{1,2}[:.]\d{2}(?:\s*h)?)?$/i);
  if (m) {
    const day = +m[1];
    const month = +m[2];
    if (m[3]) {
      const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return orError(validDate(year, month, day));
    }
    // No year: the next time this day comes around, counting today.
    const thisYear = +today.slice(0, 4);
    const candidate = validDate(thisYear, month, day);
    if (candidate && candidate >= today) return { date: candidate };
    return orError(validDate(thisYear + 1, month, day) ?? validDate(thisYear + 2, month, day));
  }

  return { date: null, error: "not a date" };
}

/** How the app writes a due date into the sheet: "15.11.2026". */
export function formatDeadline(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

function orError(date: string | null): { date: string | null; error?: string } {
  return date ? { date } : { date: null, error: "not a valid calendar date" };
}

// ---------- Row keys ----------

/**
 * Stable key per sheet row: normalised title + occurrence number among rows with the same title.
 * Inserting, sorting or deleting other rows does not change a row's key (row numbers would).
 * Renaming a task in the sheet gives it a new key, so it is imported as a new task.
 */
export function buildRowKeys(titles: string[]): string[] {
  const seen = new Map<string, number>();
  return titles.map((title) => {
    const base = normalizeText(title);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}
