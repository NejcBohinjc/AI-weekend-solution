// What a meeting has, for the small icons in the meetings lists: a recording, a transcript, an AI summary.
// Scoped to the meetings actually being listed: unscoped it scanned every recording and note, and
// `transcript is not null` made Postgres read every transcript out of TOAST for three booleans.
// Still one parameter-free statement (one round trip): the ids are whole numbers from the database,
// checked here and written into the SQL, so there is nothing to inject.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MeetingMedia = { recording: boolean; transcript: boolean; summary: boolean };
export const NO_MEDIA: MeetingMedia = { recording: false, transcript: false, summary: false };

export async function meetingMedia(meetingIds: number[]): Promise<Map<number, MeetingMedia>> {
  const ids = [...new Set(meetingIds)].filter((n) => Number.isInteger(n) && n > 0);
  const out = new Map<number, MeetingMedia>();
  if (!ids.length) return out;
  const list = sql.raw(ids.join(","));
  // union all, not union: the duplicates are removed by the Map below anyway.
  const rows = (await db.execute(sql`
    select meeting_id, 'recording' as kind from recordings where meeting_id in (${list}) and status <> 'recording'
    union all select meeting_id, 'recording' from meeting_recordings where meeting_id in (${list}) and status = 'ready'
    union all select meeting_id, 'transcript' from recordings where meeting_id in (${list}) and transcript is not null and transcript <> ''
    union all select meeting_id, 'summary' from meeting_notes where meeting_id in (${list}) and summary is not null`)) as unknown as {
    meeting_id: number;
    kind: keyof MeetingMedia;
  }[];
  for (const r of rows) out.set(r.meeting_id, { ...(out.get(r.meeting_id) ?? NO_MEDIA), [r.kind]: true });
  return out;
}
