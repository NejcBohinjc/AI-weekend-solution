// Reads for the meetings pages.
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { attendance, emailLog, meetingImports, meetingInvites, meetings, members, reminderSettings } from "@/db/schema";
import { DEFAULT_REMINDER_MINUTES } from "./constants";
import type { ImportReport } from "./import";
import { effectiveState } from "./rules";

/** The member's meetings (not removed from the calendar) with what they recorded, oldest first. */
export async function myMeetings(memberId: number) {
  return db
    .select({
      meeting: meetings,
      state: attendance.state,
      note: attendance.note,
      source: attendance.source,
      lateNotice: attendance.lateNotice,
      lateDecision: attendance.lateDecision,
    })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetingInvites.meetingId, meetings.id))
    .leftJoin(attendance, and(eq(attendance.meetingId, meetings.id), eq(attendance.memberId, memberId)))
    .where(and(eq(meetingInvites.memberId, memberId), ne(meetings.status, "removed")))
    .orderBy(asc(meetings.startsAt));
}

export async function meetingById(id: number) {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  return row ?? null;
}

/** Everyone invited to a meeting, with what was recorded and by whom. */
export async function meetingAttendees(meetingId: number) {
  const [rows, names] = await Promise.all([
    db
      .select({
        memberId: members.id,
        name: members.name,
        tier: members.tier,
        state: attendance.state,
        note: attendance.note,
        source: attendance.source,
        setById: attendance.setById,
        updatedAt: attendance.updatedAt,
        lateNotice: attendance.lateNotice,
        lateDecision: attendance.lateDecision,
        noticeAt: attendance.noticeAt,
      })
      .from(meetingInvites)
      .innerJoin(members, eq(meetingInvites.memberId, members.id))
      .leftJoin(attendance, and(eq(attendance.meetingId, meetingId), eq(attendance.memberId, members.id)))
      .where(eq(meetingInvites.meetingId, meetingId))
      .orderBy(asc(members.name)),
    db.select({ id: members.id, name: members.name }).from(members),
  ]);
  const nameOf = new Map(names.map((m) => [m.id, m.name]));
  return rows.map((r) => ({ ...r, setByName: r.setById ? (nameOf.get(r.setById) ?? null) : null }));
}

/** Every meeting with how many invitees are in each state (unrecorded ones count as unexcused once it is over). */
export async function meetingsWithCounts(now: Date) {
  const [all, rows] = await Promise.all([
    db.select().from(meetings).where(ne(meetings.status, "removed")).orderBy(asc(meetings.startsAt)),
    db
      .select({ meetingId: meetingInvites.meetingId, state: attendance.state, lateNotice: attendance.lateNotice, lateDecision: attendance.lateDecision })
      .from(meetingInvites)
      .leftJoin(attendance, and(eq(attendance.meetingId, meetingInvites.meetingId), eq(attendance.memberId, meetingInvites.memberId))),
  ]);
  // Invites grouped by meeting first: one pass over them, not one per meeting (a year of a real calendar
  // is about 1,000 meetings and 20,000 invites).
  const byMeeting = new Map<number, typeof rows>();
  for (const r of rows) {
    const list = byMeeting.get(r.meetingId);
    if (list) list.push(r);
    else byMeeting.set(r.meetingId, [r]);
  }
  return all.map((m) => {
    const counts = { present: 0, remote: 0, excused: 0, unexcused: 0, open: 0, invited: 0 };
    for (const r of byMeeting.get(m.id) ?? []) {
      counts.invited++;
      const s = effectiveState(r.state, m, now, { lateNotice: !!r.lateNotice, lateDecision: r.lateDecision });
      if (s) counts[s]++;
      else counts.open++;
    }
    return { meeting: m, counts };
  });
}

/** Attendance per member and series over meetings that are over (not cancelled). */
export async function attendanceBySeries(now: Date) {
  const rows = await db
    // Only the meeting fields used here: one row per invite, so the whole row (description and all)
    // would be sent thousands of times.
    .select({
      memberId: members.id,
      name: members.name,
      meeting: { series: meetings.series, startsAt: meetings.startsAt, endsAt: meetings.endsAt },
      state: attendance.state,
      lateNotice: attendance.lateNotice,
      lateDecision: attendance.lateDecision,
    })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetingInvites.meetingId, meetings.id))
    .innerJoin(members, and(eq(meetingInvites.memberId, members.id), eq(members.active, true)))
    .leftJoin(attendance, and(eq(attendance.meetingId, meetings.id), eq(attendance.memberId, members.id)))
    .where(eq(meetings.status, "confirmed"))
    .orderBy(asc(members.name));
  return rows
    .map((r) => ({ memberId: r.memberId, name: r.name, series: r.meeting.series, state: effectiveState(r.state, r.meeting, now, { lateNotice: !!r.lateNotice, lateDecision: r.lateDecision }) }))
    .filter((r) => r.state !== null);
}

export async function reminderSettingsFor(memberId: number) {
  const [row] = await db.select().from(reminderSettings).where(eq(reminderSettings.memberId, memberId)).limit(1);
  return { emailEnabled: row?.emailEnabled ?? true, minutesBefore: row?.minutesBefore ?? DEFAULT_REMINDER_MINUTES };
}

export async function lastMeetingImport() {
  const [row] = await db
    .select({ report: meetingImports.report, by: members.name })
    .from(meetingImports)
    .leftJoin(members, eq(meetingImports.actorId, members.id))
    .orderBy(desc(meetingImports.id))
    .limit(1);
  return row ? { report: row.report as ImportReport, by: row.by } : null;
}

export async function recentEmails(limit = 8) {
  return db.select().from(emailLog).orderBy(desc(emailLog.id)).limit(limit);
}

/** Late notices an admin has not decided on yet, oldest meeting first. */
export async function pendingLateNotices() {
  return db
    .select({ meetingId: meetings.id, title: meetings.title, startsAt: meetings.startsAt, memberId: members.id, name: members.name, note: attendance.note, noticeAt: attendance.noticeAt })
    .from(attendance)
    .innerJoin(meetings, eq(attendance.meetingId, meetings.id))
    .innerJoin(members, eq(attendance.memberId, members.id))
    .where(and(eq(attendance.state, "excused"), eq(attendance.lateNotice, true), isNull(attendance.lateDecision)))
    .orderBy(asc(meetings.startsAt));
}
