// Pure date/time helpers for work hours. Weeks run Monday to Sunday in Europe/Ljubljana.
// No I/O, so it is unit-tested (time.test.ts).
import { TIMEZONE } from "@/lib/app";
import { MAX_ENTRY_HOURS, MIN_ENTRY_SECONDS, type TimeEntrySource } from "./constants";

const HOUR_MS = 3_600_000;

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Calendar date (yyyy-mm-dd), wall-clock time (HH:MM) and weekday (1 = Monday) of an instant in Ljubljana. */
export function ljubljanaParts(at: Date): { date: string; time: string; seconds: number; weekday: number } {
  const p = Object.fromEntries(partsFormat.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    seconds: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday) + 1,
  };
}

/** How far Ljubljana is ahead of UTC at an instant: 1 h in winter, 2 h in summer. */
function offsetMs(at: Date): number {
  const p = ljubljanaParts(at);
  const [y, m, d] = p.date.split("-").map(Number);
  const [h, min] = p.time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, min, p.seconds) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of a Ljubljana wall-clock time. A time skipped by the spring clock change moves forward an hour. */
export function ljubljanaToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - offsetMs(new Date(wall));
  return new Date(wall - offsetMs(new Date(first)));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday (yyyy-mm-dd) of the Ljubljana week that contains the instant. */
export function weekStartOf(at: Date): string {
  const p = ljubljanaParts(at);
  return addDays(p.date, 1 - p.weekday);
}

/** True for a real calendar date written as yyyy-mm-dd (so not 2026-02-30). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/** True for a yyyy-mm-dd string that is a real Monday. */
export function isWeekStart(value: string): boolean {
  return isRealDate(value) && new Date(`${value}T12:00:00Z`).getUTCDay() === 1;
}

/** The instants a Ljubljana week starts and ends (Monday 00:00 to the next Monday 00:00). */
export function weekBounds(weekStart: string): { from: Date; to: Date } {
  return { from: ljubljanaToUtc(weekStart, "00:00"), to: ljubljanaToUtc(addDays(weekStart, 7), "00:00") };
}

/** Milliseconds of an entry that fall inside [from, to). A running entry (no end) counts up to now. */
export function overlapMs(startedAt: Date, endedAt: Date | null, from: Date, to: Date, now: Date): number {
  const end = (endedAt ?? now).getTime();
  return Math.max(0, Math.min(end, to.getTime()) - Math.max(startedAt.getTime(), from.getTime()));
}

/** "4 h 30 min", "45 min", "8 h". Rounds to the nearest minute. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Hours with at most one decimal, e.g. "12.5". */
export function formatHours(ms: number): string {
  return (Math.floor(Math.max(0, ms) / (HOUR_MS / 10)) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** "Fri 24 Oct" */
export function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "19–25 Oct" or "28 Sep – 4 Oct" */
export function formatWeek(weekStart: string): string {
  const fmt = (d: string, month: boolean) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", ...(month && { month: "short" }), timeZone: "UTC" });
  const end = addDays(weekStart, 6);
  return weekStart.slice(5, 7) === end.slice(5, 7) ? `${fmt(weekStart, false)}–${fmt(end, true)}` : `${fmt(weekStart, true)} – ${fmt(end, true)}`;
}

/**
 * Reads a manual entry: a date with a start and end time in Ljubljana. An end at or before the
 * start means the next day (an overnight stretch). The entry must be 1 minute to 24 hours long.
 */
export function parseEntryTimes(date: string, start: string, end: string): { startedAt: Date; endedAt: Date } | { error: string } {
  if (!isRealDate(date)) return { error: "Pick a date." };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(start) || !time.test(end)) return { error: "Enter start and end times like 09:30." };
  const startedAt = ljubljanaToUtc(date, start);
  const endedAt = ljubljanaToUtc(end > start ? date : addDays(date, 1), end);
  return checkLength(startedAt, endedAt) ?? { startedAt, endedAt };
}

/** Error message if an entry is too short or too long, else null. */
export function checkLength(startedAt: Date, endedAt: Date): { error: string } | null {
  const ms = endedAt.getTime() - startedAt.getTime();
  if (ms < MIN_ENTRY_SECONDS * 1000) return { error: "An entry must be at least a minute long." };
  if (ms > MAX_ENTRY_HOURS * HOUR_MS) return { error: `An entry can be at most ${MAX_ENTRY_HOURS} hours.` };
  return null;
}

/** Value for a datetime-local input, in Ljubljana time: "2026-10-24T17:30". */
export function toLocalInput(at: Date): string {
  const p = ljubljanaParts(at);
  return `${p.date}T${p.time}`;
}

/** Reads a datetime-local value ("2026-10-24T17:30") as Ljubljana time. */
export function fromLocalInput(value: string): Date | null {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? ljubljanaToUtc(m[1], m[2]) : null;
}

// ---------- Google Sheet rows ----------

/** Text Sheets would read as a formula (=, +, -, @) is stored as plain text instead. */
function plainText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** One "Ure dela" row: oseba, dan začetka, ura začetka, dan konca, ura konca, id. */
export function sheetRow(name: string, startedAt: Date, endedAt: Date, id: number): (string | number)[] {
  const s = ljubljanaParts(startedAt);
  const e = ljubljanaParts(endedAt);
  return [plainText(name), s.date, s.time, e.date, e.time, id];
}

/**
 * Recent weeks (newest first) without the empty weeks before the first week that has hours, so a
 * member who started recently doesn't see a row of 0% weeks. The newest week always stays.
 */
export function fromFirstWeekWithHours<T extends { totalMs: number }>(weeks: T[]): T[] {
  let last = 0;
  weeks.forEach((w, i) => {
    if (w.totalMs > 0) last = i;
  });
  return weeks.slice(0, last + 1);
}

// ---------- Rules ----------

/** Where to go back to after saving an entry: only our own hours pages, never another site. */
export function hoursReturnPath(value: unknown, fallback = "/hours"): string {
  return typeof value === "string" && /^\/(hours|admin\/hours)(?:[/?]|$)/.test(value) ? value : fallback;
}

type Viewer = { id: number; isAdmin: boolean };
type EntryRef = { memberId: number; startedAt: Date; endedAt: Date | null; source: TimeEntrySource };

/** Admins can change any finished entry; members their own finished entries from this week, except imported history. */
export function canEditEntry(viewer: Viewer, entry: EntryRef, thisWeekStart: Date): boolean {
  if (!entry.endedAt) return false;
  if (viewer.isAdmin) return true;
  return entry.memberId === viewer.id && entry.source !== "seed" && entry.startedAt >= thisWeekStart;
}

export type Pace = "met" | "on_track" | "behind" | "below";

/**
 * How a member stands against their weekly target. For the current week the target is pro-rated by
 * how much of the week has passed: under 75% of that is "behind". A finished week is "met" or "below".
 */
export function weekPace(workedMs: number, targetHours: number, weekElapsed: number): Pace {
  const worked = workedMs / HOUR_MS;
  if (worked >= targetHours) return "met";
  if (weekElapsed >= 1) return "below";
  return worked >= targetHours * weekElapsed * 0.75 ? "on_track" : "behind";
}
