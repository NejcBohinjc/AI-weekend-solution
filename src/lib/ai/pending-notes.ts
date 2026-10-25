// Meeting notes nobody has run "Create tasks from notes" on yet, for the dashboard card. A transcript
// saved as notes counts here like any other notes.
import { and, desc, eq, exists, notExists } from "drizzle-orm";
import { db } from "@/db";
import { aiTaskRuns, meetingInvites, meetingNotes, meetings } from "@/db/schema";

export async function notesWaitingForTasks(member: { id: number; isAdmin: boolean }) {
  const rows = await db
    .select({ meetingId: meetings.id, title: meetings.title, startsAt: meetings.startsAt, noteId: meetingNotes.id })
    .from(meetingNotes)
    .innerJoin(meetings, eq(meetingNotes.meetingId, meetings.id))
    .where(
      and(
        notExists(db.select({ one: aiTaskRuns.id }).from(aiTaskRuns).where(and(eq(aiTaskRuns.noteId, meetingNotes.id), eq(aiTaskRuns.ok, true)))),
        member.isAdmin
          ? undefined
          : exists(db.select({ one: meetingInvites.memberId }).from(meetingInvites).where(and(eq(meetingInvites.meetingId, meetings.id), eq(meetingInvites.memberId, member.id)))),
      ),
    )
    .orderBy(desc(meetings.startsAt));
  const byMeeting = new Map<number, { meetingId: number; title: string; startsAt: Date; notes: number }>();
  for (const r of rows) {
    const m = byMeeting.get(r.meetingId) ?? { meetingId: r.meetingId, title: r.title, startsAt: r.startsAt, notes: 0 };
    m.notes++;
    byMeeting.set(r.meetingId, m);
  }
  return { total: rows.length, meetings: [...byMeeting.values()] };
}
