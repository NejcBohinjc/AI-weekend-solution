"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/db";
import { members, timeEntries, type TimeEntry } from "@/db/schema";
import { requireAdmin, requireMember, type SessionMember } from "@/lib/auth";
import { FORGOTTEN_TIMER_HOURS, MIN_ENTRY_SECONDS } from "@/lib/hours/constants";
import { findOverlap, runningEntry } from "@/lib/hours/queries";
import { syncHoursSheet, syncHoursSheetQuietly, type HoursSheetResult } from "@/lib/hours/sheet-sync";
import {
  canEditEntry,
  checkLength,
  formatDuration,
  fromLocalInput,
  hoursReturnPath,
  parseEntryTimes,
  weekBounds,
  weekStartOf,
} from "@/lib/hours/time";

function refresh() {
  revalidatePath("/hours", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/admin/hours", "layout");
}

/** Writes changed entries to the sheet after the response is sent, so Start/Stop stay instant. */
function syncSheetLater() {
  after(syncHoursSheetQuietly);
}

// ---------- Timer ----------

export type TimerState = { error?: string; notice?: string; askEnd?: { startedAt: string } };

export async function startTimerAction(_prev: TimerState): Promise<TimerState> {
  const me = await requireMember();
  // The unique index on running entries makes a second tap (or a second device) a no-op.
  await db
    .insert(timeEntries)
    .values({ memberId: me.id, startedAt: new Date(), source: "timer" })
    .onConflictDoNothing();
  refresh();
  return {};
}

/**
 * Stops the running timer. A timer that ran longer than FORGOTTEN_TIMER_HOURS is not saved straight
 * away: the member is asked when they actually stopped (formData "endedAt", Ljubljana time).
 */
export async function stopTimerAction(_prev: TimerState, formData: FormData): Promise<TimerState> {
  const me = await requireMember();
  const running = await runningEntry(me.id);
  refresh();
  if (!running) return {};

  const now = new Date();
  let endedAt = now;
  const picked = formData.get("endedAt");
  if (typeof picked === "string" && picked) {
    const at = fromLocalInput(picked);
    if (!at) return { error: "Pick when you stopped.", askEnd: { startedAt: running.startedAt.toISOString() } };
    if (at.getTime() > now.getTime() + 60_000) {
      return { error: "That is in the future.", askEnd: { startedAt: running.startedAt.toISOString() } };
    }
    endedAt = at;
  } else if (now.getTime() - running.startedAt.getTime() > FORGOTTEN_TIMER_HOURS * 3_600_000) {
    return { askEnd: { startedAt: running.startedAt.toISOString() } };
  }

  const ms = endedAt.getTime() - running.startedAt.getTime();
  if (ms < MIN_ENTRY_SECONDS * 1000 && !picked) {
    await db.delete(timeEntries).where(and(eq(timeEntries.id, running.id), isNull(timeEntries.endedAt)));
    return { notice: "Stopped within a minute, so nothing was saved." };
  }
  const tooLong = checkLength(running.startedAt, endedAt);
  if (tooLong) return { error: tooLong.error, askEnd: { startedAt: running.startedAt.toISOString() } };

  await db
    .update(timeEntries)
    .set({ endedAt, sheetStatus: "pending", updatedAt: new Date() })
    .where(and(eq(timeEntries.id, running.id), isNull(timeEntries.endedAt)));
  syncSheetLater();
  return { notice: `Saved ${formatDuration(ms)}.` };
}

/** Throws away a running timer (started by mistake, or forgotten and not worth keeping). */
export async function discardTimerAction(_prev: TimerState): Promise<TimerState> {
  const me = await requireMember();
  await db.delete(timeEntries).where(and(eq(timeEntries.memberId, me.id), isNull(timeEntries.endedAt), isNull(timeEntries.deletedAt)));
  refresh();
  return { notice: "Timer discarded." };
}

// ---------- Manual entries and corrections ----------

// values: what was submitted, so the form shows it again after an error (React resets forms after an action).
export type EntryFormState = { error?: string; values?: { date: string; start: string; end: string } };

async function loadEditable(me: SessionMember, entryId: number): Promise<TimeEntry | null> {
  const [entry] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, entryId), isNull(timeEntries.deletedAt)))
    .limit(1);
  if (!entry) return null;
  const thisWeek = weekBounds(weekStartOf(new Date())).from;
  return canEditEntry(me, entry, thisWeek) ? entry : null;
}

/**
 * Adds an entry (entryId null) or changes one. Members add and change their own entries from this
 * week; admins can do it for anyone (forMemberId) and any week.
 */
export async function saveEntryAction(
  entryId: number | null,
  forMemberId: number | null,
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const me = await requireMember();
  const values = { date: String(formData.get("date") ?? ""), start: String(formData.get("start") ?? ""), end: String(formData.get("end") ?? "") };
  const fail = (error: string): EntryFormState => ({ error, values });
  const existing = entryId ? await loadEditable(me, entryId) : null;
  if (entryId && !existing) return fail("You can't change this entry.");

  let memberId = existing?.memberId ?? me.id;
  if (!existing && forMemberId && forMemberId !== me.id) {
    if (!me.isAdmin) return fail("Only admins can add hours for someone else.");
    const [target] = await db.select({ id: members.id }).from(members).where(eq(members.id, forMemberId)).limit(1);
    if (!target) return fail("That member does not exist.");
    memberId = target.id;
  }

  const times = parseEntryTimes(values.date, values.start, values.end);
  if ("error" in times) return fail(times.error);
  if (times.endedAt.getTime() > Date.now() + 60_000) return fail("Hours can't end in the future.");
  const thisWeek = weekBounds(weekStartOf(new Date())).from;
  if (!me.isAdmin && times.startedAt < thisWeek) return fail("You can add hours for this week only. Ask an admin for earlier weeks.");
  const clash = await findOverlap(memberId, times.startedAt, times.endedAt, existing?.id);
  if (clash) return fail("This overlaps another entry. Change that one or pick other times.");

  const byAdmin = memberId !== me.id ? me.id : null;
  if (existing) {
    await db
      .update(timeEntries)
      .set({
        startedAt: times.startedAt,
        endedAt: times.endedAt,
        editedById: byAdmin ?? existing.editedById,
        sheetStatus: existing.source === "seed" ? "skip" : "pending",
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, existing.id));
  } else {
    await db.insert(timeEntries).values({ memberId, startedAt: times.startedAt, endedAt: times.endedAt, source: "manual", editedById: byAdmin });
  }
  syncSheetLater();
  refresh();
  redirect(hoursReturnPath(formData.get("returnTo")));
}

/** Deletes an entry. It is kept as deleted until its sheet row is removed. */
export async function deleteEntryAction(entryId: number, formData: FormData): Promise<void> {
  const me = await requireMember();
  const entry = await loadEditable(me, entryId);
  if (entry) {
    await db
      .update(timeEntries)
      .set({
        deletedAt: new Date(),
        editedById: entry.memberId !== me.id ? me.id : entry.editedById,
        sheetStatus: entry.source === "seed" ? "skip" : "pending",
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, entry.id));
    syncSheetLater();
    refresh();
  }
  redirect(hoursReturnPath(formData.get("returnTo")));
}

// ---------- Admin ----------

export async function retryHoursSheetAction(_prev: HoursSheetResult | null): Promise<HoursSheetResult> {
  await requireAdmin();
  const result = await syncHoursSheet();
  refresh();
  return result;
}
