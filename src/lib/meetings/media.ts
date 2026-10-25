// What a meeting has, for the small icons in the meetings lists: a recording, a transcript, an AI summary.
// One parameter-free statement (one round trip), for every meeting; the lists only look up the meetings
// the viewer is allowed to see anyway. Existence only: nothing of the content leaves this file.
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MeetingMedia = { recording: boolean; transcript: boolean; summary: boolean };
export const NO_MEDIA: MeetingMedia = { recording: false, transcript: false, summary: false };

export async function meetingMedia(): Promise<Map<number, MeetingMedia>> {
  const rows = (await db.execute(sql`
    select meeting_id, 'recording' as kind from recordings where status <> 'recording'
    union select meeting_id, 'recording' from meeting_recordings where status = 'ready'
    union select meeting_id, 'transcript' from recordings where transcript is not null and transcript <> ''
    union select meeting_id, 'summary' from meeting_notes where summary is not null`)) as unknown as { meeting_id: number; kind: keyof MeetingMedia }[];
  const out = new Map<number, MeetingMedia>();
  for (const r of rows) out.set(r.meeting_id, { ...(out.get(r.meeting_id) ?? NO_MEDIA), [r.kind]: true });
  return out;
}
