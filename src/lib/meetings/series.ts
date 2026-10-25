// Meeting series as a whole: an overview for Admin → Meetings, and deleting a series that should not be
// there (e.g. after importing the wrong calendar file). Deleting removes its meetings with their
// invites, attendance, notes and reminders (cascade), withdraws their Slack announcements, and forgets
// the series' Slack channel. A series with recordings is refused, so no audio files are left behind.
import { and, count, eq, inArray, max, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, meetings, recordings, slackAnnouncements, slackChannels } from "@/db/schema";
import { slackClient, SlackError, type SlackApi } from "@/lib/slack/client";

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

export type DeleteSeriesResult = { error?: string; meetings?: number; slackRemoved?: number; slackProblems?: string[] };

export async function deleteSeries(series: string, api: SlackApi | null = slackClient()): Promise<DeleteSeriesResult> {
  const list = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.series, series));
  if (!list.length) return { error: "That series has no meetings (any more)." };
  const ids = list.map((m) => m.id);
  const [{ n: recs }] = await db.select({ n: count() }).from(recordings).where(inArray(recordings.meetingId, ids));
  if (recs > 0) return { error: `This series has ${recs} recording${recs === 1 ? "" : "s"}. Delete them on the meeting pages first.` };

  // Slack first: once the meetings are gone, their announcement rows (with the message ids) are too.
  let slackRemoved = 0;
  const slackProblems: string[] = [];

  const announced = await db
    .select()
    .from(slackAnnouncements)
    .where(and(inArray(slackAnnouncements.meetingId, ids), inArray(slackAnnouncements.status, ["scheduled", "posted"])));
  if (api) {
    for (const a of announced) {
      if (!a.channelId) continue;
      try {
        if (a.status === "scheduled" && a.scheduledMessageId) {
          await api.call("chat.deleteScheduledMessage", { channel: a.channelId, scheduled_message_id: a.scheduledMessageId });
          slackRemoved++;
        } else if (a.status === "posted" && a.messageTs) {
          await api.call("chat.delete", { channel: a.channelId, ts: a.messageTs });
          slackRemoved++;
        }
      } catch (err) {
        // Already gone in Slack is fine; anything else is reported, the meetings are deleted anyway.
        const code = err instanceof SlackError ? err.code : (err as Error).message;
        if (!["invalid_scheduled_message_id", "message_not_found"].includes(code)) slackProblems.push(code);
      }
    }
  } else if (announced.length) {
    slackProblems.push("Slack is not connected here, so its announcements were not withdrawn");
  }

  await db.transaction(async (tx) => {
    await tx.delete(meetings).where(inArray(meetings.id, ids));
    await tx.delete(slackChannels).where(eq(slackChannels.series, series));
  });
  return { meetings: ids.length, slackRemoved, slackProblems: [...new Set(slackProblems)] };
}

/** Series that still have meetings that are not removed or cancelled (for the Slack channel list). */
export async function activeSeries(): Promise<string[]> {
  const rows = await db.selectDistinct({ series: meetings.series }).from(meetings).where(eq(meetings.status, "confirmed"));
  return rows.map((r) => r.series).sort();
}

