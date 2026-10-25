// Saves meetings read from an .ics file into the database. Idempotent: meetings are matched by UID,
// invitees (matched to members by email) are replaced, and attendance is never touched. When the
// import is the whole calendar (the calendar address always is; a file upload says so), a future
// meeting missing from it is marked "removed" (hidden, not deleted).
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { meetingImports, meetingInvites, meetingReminders, meetings, members, type Meeting } from "@/db/schema";
import type { MeetingStatus } from "./constants";
import { parseIcs, type ParsedMeeting } from "./ics";

export type ImportSource = "file" | "url" | "seed";

export type ImportReport = {
  ok: boolean;
  error?: string;
  source: ImportSource;
  at: string;
  meetings: number;
  created: number;
  updated: number;
  unchanged: number;
  cancelled: number;
  /** Meetings matched by title and start because the calendar gave them a new UID. */
  relinked: number;
  invites: number;
  removed: { title: string; startsAt: string }[];
  unknownEmails: { email: string; meetings: number }[];
  skipped: number;
};

const DAY = 86_400_000;

/** Recurring events are expanded from half a year back to a year ahead. */
export function importWindow(now = new Date()) {
  return { from: new Date(now.getTime() - 183 * DAY), to: new Date(now.getTime() + 366 * DAY) };
}

function emptyReport(source: ImportSource): ImportReport {
  return {
    ok: true,
    source,
    at: new Date().toISOString(),
    meetings: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    cancelled: 0,
    relinked: 0,
    invites: 0,
    removed: [],
    unknownEmails: [],
    skipped: 0,
  };
}

async function saveReport(report: ImportReport, actorId: number | null): Promise<ImportReport> {
  await db.insert(meetingImports).values({ actorId, source: report.source, ok: report.ok, report });
  return report;
}

export async function recordFailedImport(source: ImportSource, error: string, actorId: number | null): Promise<ImportReport> {
  return saveReport({ ...emptyReport(source), ok: false, error }, actorId);
}

export async function importMeetings(
  parsed: ParsedMeeting[],
  {
    source,
    actorId,
    skipped = 0,
    wholeCalendar = true,
    now = new Date(),
  }: { source: ImportSource; actorId: number | null; skipped?: number; wholeCalendar?: boolean; now?: Date },
): Promise<ImportReport> {
  const report = emptyReport(source);
  report.meetings = parsed.length;
  report.skipped = skipped;
  const memberIds = new Map(
    (await db.select({ id: members.id, email: members.email }).from(members).where(eq(members.active, true))).map((m) => [m.email, m.id]),
  );
  const unknown = new Map<string, number>();

  await db.transaction(async (tx) => {
    // One import at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('meetings_import'))`);
    const [rows, inviteRows] = await Promise.all([tx.select().from(meetings), tx.select().from(meetingInvites)]);
    const existing = new Map(rows.map((m) => [m.uid, m]));
    // Who is invited now, to rewrite a meeting's invites only when they changed (most pulls change nothing).
    const invitedNow = new Map<number, Set<number>>();
    for (const i of inviteRows) invitedNow.set(i.meetingId, (invitedNow.get(i.meetingId) ?? new Set()).add(i.memberId));
    // The same meeting can come back under another UID (Google Calendar gives events new UIDs when
    // an .ics file is imported into it). Matched by title and start, it keeps its attendance history.
    const incoming = new Set(parsed.map((p) => p.uid));
    const byTitleAndStart = new Map(rows.filter((m) => !incoming.has(m.uid)).map((m) => [`${m.title}|${m.startsAt.toISOString()}`, m]));
    const seen = new Set<number>(); // meeting ids in this import

    for (const p of parsed) {
      const status: MeetingStatus = p.cancelled ? "cancelled" : "confirmed";
      if (p.cancelled) report.cancelled++;
      const values = { title: p.title, series: p.series, startsAt: p.startsAt, endsAt: p.endsAt, location: p.location, description: p.description, status };
      let old = existing.get(p.uid);
      const twin = old ? undefined : byTitleAndStart.get(`${p.title}|${p.startsAt.toISOString()}`);
      if (twin && !seen.has(twin.id)) {
        await tx.update(meetings).set({ uid: p.uid }).where(eq(meetings.id, twin.id));
        old = { ...twin, uid: p.uid };
        report.relinked++;
      }
      let id: number;
      if (!old) {
        [{ id }] = await tx.insert(meetings).values({ uid: p.uid, ...values }).returning({ id: meetings.id });
        report.created++;
      } else {
        id = old.id;
        if (changed(old, values)) {
          await tx.update(meetings).set({ ...values, updatedAt: new Date() }).where(eq(meetings.id, id));
          // Moved to another time: reminders go out again for the new time.
          if (old.startsAt.getTime() !== p.startsAt.getTime()) await tx.delete(meetingReminders).where(eq(meetingReminders.meetingId, id));
          report.updated++;
        } else {
          report.unchanged++;
        }
      }

      seen.add(id);

      const invited = [...new Set(p.emails.map((e) => memberIds.get(e)).filter((x): x is number => x !== undefined))];
      for (const e of p.emails) if (!memberIds.has(e)) unknown.set(e, (unknown.get(e) ?? 0) + 1);
      const before = invitedNow.get(id) ?? new Set<number>();
      if (before.size !== invited.length || invited.some((memberId) => !before.has(memberId))) {
        await tx.delete(meetingInvites).where(eq(meetingInvites.meetingId, id));
        if (invited.length) await tx.insert(meetingInvites).values(invited.map((memberId) => ({ meetingId: id, memberId })));
      }
      report.invites += invited.length;
    }

    // Future meetings no longer in the calendar: hidden and no reminders, but kept with their history.
    const gone = wholeCalendar ? rows.filter((m) => !seen.has(m.id) && m.startsAt > now && m.status !== "removed") : [];
    if (gone.length) {
      await tx.update(meetings).set({ status: "removed", updatedAt: new Date() }).where(inArray(meetings.id, gone.map((m) => m.id)));
      report.removed = gone.map((m) => ({ title: m.title, startsAt: m.startsAt.toISOString() }));
    }
  });

  report.unknownEmails = [...unknown].map(([email, n]) => ({ email, meetings: n })).sort((a, b) => a.email.localeCompare(b.email));
  return saveReport(report, actorId);
}

function changed(old: Meeting, next: Pick<Meeting, "title" | "series" | "startsAt" | "endsAt" | "location" | "description" | "status">): boolean {
  return (
    old.title !== next.title ||
    old.series !== next.series ||
    old.startsAt.getTime() !== next.startsAt.getTime() ||
    old.endsAt.getTime() !== next.endsAt.getTime() ||
    old.location !== next.location ||
    old.description !== next.description ||
    old.status !== next.status
  );
}

/** Parses and imports an .ics text; a file that cannot be read is reported, not thrown. */
export async function importIcsText(text: string, source: ImportSource, actorId: number | null, wholeCalendar = true): Promise<ImportReport> {
  let parsed: ReturnType<typeof parseIcs>;
  try {
    parsed = parseIcs(text, importWindow());
  } catch (err) {
    return recordFailedImport(source, `This is not a calendar (.ics) file: ${(err as Error).message}`, actorId);
  }
  if (!parsed.meetings.length) return recordFailedImport(source, "The file has no events.", actorId);
  return importMeetings(parsed.meetings, { source, actorId, skipped: parsed.skipped, wholeCalendar });
}

export function calendarUrl(): string | null {
  return process.env.MEETINGS_ICS_URL || null;
}

/** Downloads the calendar from MEETINGS_ICS_URL (Google Calendar: Settings → "Secret address in iCal format"). */
export async function importFromCalendarUrl(actorId: number | null): Promise<ImportReport> {
  const url = calendarUrl();
  if (!url) return recordFailedImport("url", "MEETINGS_ICS_URL is not set.", actorId);
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return recordFailedImport("url", `The calendar address answered ${res.status} ${res.statusText}.`, actorId);
    return importIcsText(await res.text(), "url", actorId);
  } catch (err) {
    return recordFailedImport("url", `Could not download the calendar: ${(err as Error).message}`, actorId);
  }
}

/** How often meetings are pulled from MEETINGS_ICS_URL. */
export const CALENDAR_SYNC_MINUTES = 15;

/** The latest attempt to pull from the calendar address, successful or not. */
export async function lastCalendarSync(): Promise<{ at: Date; ok: boolean; error: string | null } | null> {
  // Called on page views (in the background): only the error text of the report is needed, not the whole report.
  const [last] = await db
    .select({ at: meetingImports.createdAt, ok: meetingImports.ok, error: sql<string | null>`${meetingImports.report}->>'error'` })
    .from(meetingImports)
    .where(eq(meetingImports.source, "url"))
    .orderBy(desc(meetingImports.id))
    .limit(1);
  return last ? { at: last.at, ok: last.ok, error: last.error } : null;
}

// One pull at a time per server process, so a burst of page views downloads the calendar once.
let pulling: Promise<ImportReport | null> | null = null;

/**
 * Pulls the calendar when the last attempt (successful or not, so a broken address is not retried on
 * every request) is older than `maxAgeMinutes`. Called on page views and by the scheduled job.
 */
export function syncCalendarIfStale(maxAgeMinutes = CALENDAR_SYNC_MINUTES): Promise<ImportReport | null> {
  if (!calendarUrl()) return Promise.resolve(null);
  pulling ??= (async () => {
    const last = await lastCalendarSync();
    if (last && Date.now() - last.at.getTime() < maxAgeMinutes * 60_000) return null;
    return importFromCalendarUrl(null);
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}
