import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetingRecordings, members, type Meeting } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import type { SessionMember } from "@/lib/auth";
import { canStartRecording, canUploadRecording, formatBytes, formatSeconds, isVideo } from "@/lib/meetings/recordings";
import { playUrl, storageMode } from "@/lib/storage";
import { MeetingRecorder } from "./meeting-recorder";
import { deleteRecordingAction } from "./recording-actions";
import { RecordingUploadForm } from "./recording-upload-form";

const UNFINISHED_AFTER_MS = 60 * 60_000;

/**
 * The meeting's recordings with players, the in-room recorder while the meeting is on (invitees and
 * admins), and the upload form for admins once it has happened and has no recording. Only rendered on
 * the meeting page, which only invitees and admins can open.
 */
export async function RecordingsSection({ meeting, me, invited, now }: { meeting: Meeting; me: SessionMember; invited: boolean; now: Date }) {
  const rows = await db
    .select({ recording: meetingRecordings, by: members.name })
    .from(meetingRecordings)
    .leftJoin(members, eq(meetingRecordings.uploadedById, members.id))
    .where(eq(meetingRecordings.meetingId, meeting.id))
    .orderBy(asc(meetingRecordings.createdAt));
  const ready = rows.filter((r) => r.recording.status === "ready");
  // Uploads that never finished (the page was closed): only admins see them, to delete them.
  const stuck = rows.filter((r) => r.recording.status === "uploading" && now.getTime() - r.recording.createdAt.getTime() > UNFINISHED_AFTER_MS);
  const players = await Promise.all(
    ready.map(async (r) => ({ ...r, src: await playUrl(r.recording.storageKey, r.recording.contentType, `/api/recordings/${r.recording.id}/file`) })),
  );

  const times = { ...meeting, cancelled: meeting.status !== "confirmed" };
  const mode = storageMode();
  const showRecorder = (invited || me.isAdmin) && canStartRecording(times, now);
  const showUpload = me.isAdmin && mode !== "none" && canUploadRecording(times, ready.length > 0, now);
  if (!players.length && !showRecorder && !showUpload && !(me.isAdmin && stuck.length)) return null;

  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const fileBase = `${meeting.title} ${meeting.startsAt.toISOString().slice(0, 10)}`.replace(/[^\p{L}\p{N} _-]+/gu, "").trim();

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="meeting-recordings">
      <h2 className="font-semibold">Recording</h2>

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
              <form action={deleteRecordingAction.bind(null, r.id)} className="mt-2 flex flex-wrap items-center gap-2">
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
          <form key={r.id} action={deleteRecordingAction.bind(null, r.id)} className="flex flex-wrap items-center gap-2 text-xs text-warning">
            An upload by {by ?? "a former member"} on {fmt(r.createdAt)} did not finish.
            <button type="submit" className="font-medium text-danger hover:underline">
              Remove it
            </button>
          </form>
        ))}

      {showRecorder && <MeetingRecorder meetingId={meeting.id} fileBase={fileBase} storageOn={mode !== "none"} />}
      {showUpload && <RecordingUploadForm meetingId={meeting.id} />}
      {me.isAdmin && mode === "none" && (
        <p className="text-xs text-subtle">Recording storage is not set up (RECORDINGS_S3_* variables), so recordings cannot be stored yet. (Only admins see this.)</p>
      )}
    </div>
  );
}
