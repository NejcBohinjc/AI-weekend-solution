// Reads for the hours pages. Totals are computed in JavaScript from the entries, clipped to each
// week (see overlapMs), which is plenty fast for a 20-person organisation.
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { members, timeEntries, type TimeEntry } from "@/db/schema";
import { getSyncState } from "@/lib/sync-state";
import type { WorkLocation } from "./constants";
import { locationTotals } from "./location";
import { HOURS_SYNC } from "./sheet-sync";
import { addDays, overlapMs, weekBounds } from "./time";

const notDeleted = isNull(timeEntries.deletedAt);

export async function runningEntry(memberId: number): Promise<TimeEntry | null> {
  const [row] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.memberId, memberId), isNull(timeEntries.endedAt), notDeleted))
    .limit(1);
  return row ?? null;
}

/** Entries of one member that overlap [from, to), newest first. */
export async function entriesBetween(memberId: number, from: Date, to: Date): Promise<TimeEntry[]> {
  return db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.memberId, memberId),
        notDeleted,
        lt(timeEntries.startedAt, to),
        or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, from)),
      ),
    )
    .orderBy(desc(timeEntries.startedAt));
}

export function totalMs(entries: Pick<TimeEntry, "startedAt" | "endedAt">[], from: Date, to: Date, now: Date): number {
  return entries.reduce((sum, e) => sum + overlapMs(e.startedAt, e.endedAt, from, to, now), 0);
}

/** One member's week: its entries, total (also split by office / home / unspecified), and the running timer if any. */
export async function memberWeek(memberId: number, weekStart: string, now: Date) {
  const { from, to } = weekBounds(weekStart);
  const [entries, running] = await Promise.all([entriesBetween(memberId, from, to), runningEntry(memberId)]);
  return { entries, running, totalMs: totalMs(entries, from, to, now), byLocation: locationTotals(entries, from, to, now), from, to };
}

/** Totals for the last `count` weeks up to and including `lastWeek`, newest first. */
export async function weeklyTotals(memberId: number, lastWeek: string, count: number, now: Date) {
  const weeks = Array.from({ length: count }, (_, i) => addDays(lastWeek, -7 * i));
  const from = weekBounds(weeks[weeks.length - 1]).from;
  const to = weekBounds(lastWeek).to;
  const entries = await entriesBetween(memberId, from, to);
  return weeks.map((week) => {
    const b = weekBounds(week);
    return { week, totalMs: totalMs(entries, b.from, b.to, now), byLocation: locationTotals(entries, b.from, b.to, now) };
  });
}

/** Every active member with their total for the week and whether a timer is running now. */
export async function teamWeek(weekStart: string, now: Date) {
  const { from, to } = weekBounds(weekStart);
  const [people, entries] = await Promise.all([
    db
      .select({ id: members.id, name: members.name, tier: members.tier, weeklyHours: members.weeklyHours })
      .from(members)
      .where(eq(members.active, true))
      .orderBy(asc(members.name)),
    db
      .select({ memberId: timeEntries.memberId, startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt })
      .from(timeEntries)
      // Entries in the week, plus running timers (for "working now", even when looking at a past week).
      .where(
        and(
          notDeleted,
          or(and(lt(timeEntries.startedAt, to), or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, from))), isNull(timeEntries.endedAt)),
        ),
      ),
  ]);
  return people.map((p) => {
    const own = entries.filter((e) => e.memberId === p.id);
    return { ...p, totalMs: totalMs(own, from, to, now), working: own.some((e) => !e.endedAt) };
  });
}

/** Entries still waiting to be written to (or removed from) the sheet, and the latest error. */
export async function hoursSheetQueue() {
  const [rows, state] = await Promise.all([
    db
      .select({ error: timeEntries.sheetError, updatedAt: timeEntries.updatedAt })
      .from(timeEntries)
      .where(and(eq(timeEntries.sheetStatus, "pending"), or(isNotNull(timeEntries.endedAt), isNotNull(timeEntries.deletedAt))))
      .orderBy(desc(timeEntries.updatedAt)),
    getSyncState(HOURS_SYNC),
  ]);
  return {
    pending: rows.length,
    failed: rows.filter((r) => r.error).length,
    // The last run's error (e.g. missing configuration, 403) if it failed, else the latest entry error.
    lastError: (state?.lastOk === false ? state.lastError : null) ?? rows.find((r) => r.error)?.error ?? null,
    lastRunAt: state?.lastFinishedAt ?? null,
  };
}

/** An entry of the member (a running timer counts as open-ended) that overlaps [startedAt, endedAt), other than `exceptId`. */
export async function findOverlap(memberId: number, startedAt: Date, endedAt: Date, exceptId?: number): Promise<TimeEntry | null> {
  const [row] = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.memberId, memberId),
        notDeleted,
        exceptId ? ne(timeEntries.id, exceptId) : undefined,
        lt(timeEntries.startedAt, endedAt),
        or(isNull(timeEntries.endedAt), gt(timeEntries.endedAt, startedAt)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The location of the member's most recent entry that has one: the default for the next one. */
export async function lastLocation(memberId: number): Promise<WorkLocation> {
  const [row] = await db
    .select({ location: timeEntries.location })
    .from(timeEntries)
    .where(and(eq(timeEntries.memberId, memberId), isNotNull(timeEntries.location), notDeleted))
    .orderBy(desc(timeEntries.startedAt))
    .limit(1);
  return row?.location ?? "office";
}
