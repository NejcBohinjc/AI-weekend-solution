// Meeting series as a whole: an overview for Admin → Meetings, and deleting a series that should not be
// there (e.g. after importing the wrong calendar file). Deleting removes its meetings with their
// invites, attendance, notes and reminders (cascade), queues their Slack announcements to be taken back,
// and forgets the series' Slack channel. A series with recordings is refused, so no audio files are left
// behind.
import { and, count, eq, inArray, max, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiQuestions, attendance, generalTaskRequests, meetings, recordings, slackAnnouncements, slackChannels, slackWithdrawals } from "@/db/schema";

export type SeriesRow = {
  series: string;
  meetings: number;
  upcoming: number; // confirmed and not started yet
  active: number; // not removed or cancelled
  first: Date | null;
  last: Date | null;
  attendance: number; // attendance records (all sources)
  recordings: number;
};

export async function seriesOverview(now = new Date()): Promise<SeriesRow[]> {
  const [base, att, rec] = await Promise.all([
    db
      .select({
        series: meetings.series,
        meetings: count(),
        upcoming: sql<number>`count(*) filter (where ${meetings.status} = 'confirmed' and ${meetings.startsAt} > ${now.toISOString()}::timestamptz)`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${meetings.status} = 'confirmed')`.mapWith(Number),
        first: min(meetings.startsAt),
        last: max(meetings.startsAt),
      })
      .from(meetings)
      .groupBy(meetings.series),
    db.select({ series: meetings.series, n: count() }).from(attendance).innerJoin(meetings, eq(attendance.meetingId, meetings.id)).groupBy(meetings.series),
    db.select({ series: meetings.series, n: count() }).from(recordings).innerJoin(meetings, eq(recordings.meetingId, meetings.id)).groupBy(meetings.series),
  ]);
  const of = (rows: { series: string; n: number }[], s: string) => rows.find((r) => r.series === s)?.n ?? 0;
  return base
    .map((b) => ({ ...b, attendance: of(att, b.series), recordings: of(rec, b.series) }))
    .sort((a, b) => a.series.localeCompare(b.series));
}

export type DeleteSeriesResult = { error?: string; meetings?: number; slackQueued?: number };

/**
 * Deletes the series' meetings in one transaction, without waiting for Slack: their Slack messages
 * (scheduled or posted) are queued in slack_withdrawals, which the Slack sync works through in batches.
 */
export async function deleteSeries(series: string): Promise<DeleteSeriesResult> {
  const list = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.series, series));
  if (!list.length) return { error: "That series has no meetings (any more)." };
  const ids = list.map((m) => m.id);
  const [{ n: recs }] = await db.select({ n: count() }).from(recordings).where(inArray(recordings.meetingId, ids));
  if (recs > 0) return { error: `This series has ${recs} recording${recs === 1 ? "" : "s"}. Delete them on the meeting pages first.` };

  let slackQueued = 0;
  await db.transaction(async (tx) => {
    // Once the meetings are gone their announcement rows (with the Slack message ids) are too: queue them first.
    const announced = await tx
      .select()
      .from(slackAnnouncements)
      .where(and(inArray(slackAnnouncements.meetingId, ids), inArray(slackAnnouncements.status, ["scheduled", "posted"])));
    const queue = announced
      .filter((a) => a.channelId && (a.status === "scheduled" ? a.scheduledMessageId : a.messageTs))
      .map((a) =>
        a.status === "scheduled"
          ? { channelId: a.channelId!, scheduledMessageId: a.scheduledMessageId, postAt: a.postAt }
          : { channelId: a.channelId!, messageTs: a.messageTs },
      );
    // One message can stand for two announcements (missed ones posted together): queue it once.
    const unique = [...new Map(queue.map((q) => [`${q.channelId}:${"scheduledMessageId" in q ? q.scheduledMessageId : q.messageTs}`, q])).values()];
    if (unique.length) await tx.insert(slackWithdrawals).values(unique);
    slackQueued = unique.length;
    // These two references have no index: one statement each instead of one table scan per meeting.
    await tx.update(aiQuestions).set({ meetingId: null }).where(inArray(aiQuestions.meetingId, ids));
    await tx.delete(generalTaskRequests).where(inArray(generalTaskRequests.meetingId, ids));
    await tx.delete(meetings).where(inArray(meetings.id, ids)); // invites, attendance, notes, ... by cascade
    await tx.delete(slackChannels).where(eq(slackChannels.series, series));
  });
  return { meetings: ids.length, slackQueued };
}

/** Series that still have meetings that are not removed or cancelled (for the Slack channel list). */
export async function activeSeries(): Promise<string[]> {
  const rows = await db.selectDistinct({ series: meetings.series }).from(meetings).where(eq(meetings.status, "confirmed"));
  return rows.map((r) => r.series).sort();
}
