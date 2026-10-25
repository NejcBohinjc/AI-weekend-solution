import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingRecordings, members, type MeetingRecording } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import type { SessionMember } from "@/lib/auth";
import { formatBytes, formatSeconds, isVideo } from "@/lib/meetings/recordings";
import { playUrl } from "@/lib/storage";
import { deleteEarlierRecordingAction } from "./recording-actions";

const UNFINISHED_AFTER_MS = 60 * 60_000;

export type EarlierRecording = { recording: MeetingRecording; by: string | null };

/**
 * Recordings made with the first recorder (one file per meeting in an S3-compatible bucket, table
 * meeting_recordings). New recordings are made with the meeting recorder; these stay playable. No access
 * check here: the meeting page loads them in its one query wave and only renders them after its own
 * invitee-or-admin check.
 */
export function earlierRecordings(meetingId: number): Promise<EarlierRecording[]> {
  return db
    .select({ recording: meetingRecordings, by: members.name })
    .from(meetingRecordings)
    .leftJoin(members, eq(meetingRecordings.uploadedById, members.id))
    .where(eq(meetingRecordings.meetingId, meetingId))
    .orderBy(asc(meetingRecordings.createdAt));
}

/** Players for the earlier recordings; admins can delete them (and uploads that never finished). */
export async function EarlierRecordings({ rows, me, now }: { rows: EarlierRecording[]; me: SessionMember; now: Date }) {
  const ready = rows.filter((r) => r.recording.status === "ready");
  // Uploads that never finished (the page was closed): only admins see them, to delete them.
  const stuck = rows.filter((r) => r.recording.status === "uploading" && now.getTime() - r.recording.createdAt.getTime() > UNFINISHED_AFTER_MS);
  if (!ready.length && !(me.isAdmin && stuck.length)) return null;
  // Signing a link is computed locally (no request to the bucket).
  const players = await Promise.all(
    ready.map(async (r) => ({ ...r, src: await playUrl(r.recording.storageKey, r.recording.contentType, `/api/recordings/${r.recording.id}/file`) })),
  );
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card" data-testid="meeting-recordings">
      <h2 className="font-semibold">Earlier recordings</h2>

      {players.map(({ recording: r, by, src }) => (
        <div key={r.id} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
          {isVideo(r.contentType) ? (
            <video controls preload="metadata" src={src} className="w-full rounded-lg bg-surface-3" />
          ) : (
            <audio controls preload="metadata" src={src} className="w-full" />
          )}
          <p className="text-xs text-subtle">
            {r.source === "recorded" ? "Recorded in the room" : "Uploaded"} by {by ?? "a former member"} on {fmt(r.readyAt ?? r.createdAt)}
            {r.durationSeconds ? ` · ${formatSeconds(r.durationSeconds)}` : ""} · {formatBytes(r.sizeBytes)}
          </p>
          {me.isAdmin && (
            // A second click, because a deleted recording cannot be brought back.
            <details className="text-xs">
              <summary className="cursor-pointer font-medium text-danger hover:underline">Delete recording</summary>
              <form action={deleteEarlierRecordingAction.bind(null, r.id)} className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-fg-2">The recording is deleted for good.</span>
                <button
                  type="submit"
                  aria-label={`Delete the recording from ${fmt(r.createdAt)} for good`}
                  className="rounded-lg bg-danger-solid px-3 py-1.5 font-semibold text-on-primary hover:bg-danger-solid-hover"
                >
                  Delete for good
                </button>
              </form>
            </details>
          )}
        </div>
      ))}

      {me.isAdmin &&
        stuck.map(({ recording: r, by }) => (
          <form key={r.id} action={deleteEarlierRecordingAction.bind(null, r.id)} className="flex flex-wrap items-center gap-2 text-xs text-warning">
            An upload by {by ?? "a former member"} on {fmt(r.createdAt)} did not finish.
            <button type="submit" className="font-medium text-danger hover:underline">
              Remove it
            </button>
          </form>
        ))}
    </div>
  );
}
