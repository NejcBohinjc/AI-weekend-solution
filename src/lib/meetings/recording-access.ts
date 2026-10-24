// Who may play a recording: the meeting's invitees and admins (the same people who see the meeting page).
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingInvites, meetingRecordings, type MeetingRecording } from "@/db/schema";
import type { SessionMember } from "@/lib/auth";

export async function playableRecording(me: SessionMember, recordingId: number): Promise<MeetingRecording | null> {
  const [row] = await db
    .select()
    .from(meetingRecordings)
    .where(and(eq(meetingRecordings.id, recordingId), eq(meetingRecordings.status, "ready")))
    .limit(1);
  if (!row) return null;
  if (me.isAdmin) return row;
  const [invite] = await db
    .select({ id: meetingInvites.memberId })
    .from(meetingInvites)
    .where(and(eq(meetingInvites.meetingId, row.meetingId), eq(meetingInvites.memberId, me.id)))
    .limit(1);
  return invite ? row : null;
}
