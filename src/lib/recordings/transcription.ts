// Transcribing a recording, part by part, in the background (after()). A run holds a lease on the
// recording, claims one part at a time (skip locked), and stops after a time budget so it never hits
// the function timeout; the progress poll from the meeting page starts another run while parts are
// left. Failed parts can be retried on their own. The joined transcript gets a [hh:mm:ss] mark per part.
// Nothing here creates tasks: the admin edits the transcript and saves it as meeting notes first.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { meetingInvites, meetingNotes, meetings, members, recordings, recordingSegments, type RecordingSegment } from "@/db/schema";
import { cleanNotes, NOTES_MAX_CHARS } from "@/lib/ai/meeting-tasks";
import { hashNotes } from "@/lib/ai/meeting-tasks-run";
import { RateLimitError, TRANSCRIBE_NOT_SET_UP, transcribeAudio, transcribeEnabled, type Transcriber } from "@/lib/ai/transcribe";
import { ljubljanaParts } from "@/lib/hours/time";
import { supabaseStore, type ObjectStore } from "@/lib/storage/supabase";
import { TRANSCRIBE_LANGUAGES } from "./constants";
import { joinTranscripts } from "./join";
import { RecordingError, type Member } from "./service";

const LEASE = "2 minutes";
const STALE_PART = "6 minutes"; // a part "running" this long was abandoned by a crashed run
/** Queues every part (or only the failed ones) and marks the recording as transcribing. */
export async function startTranscription(member: Member, recordingId: number, opts: { languages: string; onlyFailed?: boolean }): Promise<void> {
  if (!member.isAdmin) throw new RecordingError("Only admins can transcribe recordings.");
  if (!transcribeEnabled()) throw new RecordingError(TRANSCRIBE_NOT_SET_UP);
  const languages = TRANSCRIBE_LANGUAGES[opts.languages] ? opts.languages : "sl";
  const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1);
  if (!rec) throw new RecordingError("Recording not found.");
  if (rec.status === "recording") throw new RecordingError("Finish the recording first.");
  if (rec.status === "transcribing") return;
  await db.transaction(async (tx) => {
    if (opts.onlyFailed) {
      await tx
        .update(recordingSegments)
        .set({ transcriptStatus: "pending", transcriptError: null })
        .where(and(eq(recordingSegments.recordingId, rec.id), eq(recordingSegments.transcriptStatus, "failed")));
    } else {
      await tx
        .update(recordingSegments)
        .set({ transcriptStatus: "pending", transcriptError: null, transcript: null })
        .where(eq(recordingSegments.recordingId, rec.id));
    }
    await tx
      .update(recordings)
      .set({ status: "transcribing", error: null, languages, transcribeLeaseUntil: null, updatedAt: new Date() })
      .where(eq(recordings.id, rec.id));
  });
}

type RunDeps = { store?: ObjectStore; transcribe?: Transcriber; budgetMs?: number; concurrency?: number };

/** Transcribes queued parts until none are left or the time budget is used. "busy" if another run holds the lease. */
export async function runTranscription(recordingId: number, deps: RunDeps = {}): Promise<"busy" | "continue" | "done"> {
  const { store = supabaseStore, transcribe = transcribeAudio, budgetMs = 240_000, concurrency = 2 } = deps;
  const leased = await db.execute(sql`
    update recordings set transcribe_lease_until = now() + ${LEASE}::interval
    where id = ${recordingId} and status = 'transcribing'
      and (transcribe_lease_until is null or transcribe_lease_until < now())
    returning id`);
  if (!leased.length) return "busy";
  const deadline = Date.now() + budgetMs;

  const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1);
  const [meeting] = await db.select({ title: meetings.title, series: meetings.series }).from(meetings).where(eq(meetings.id, rec.meetingId)).limit(1);
  const names = await db
    .select({ name: members.name })
    .from(meetingInvites)
    .innerJoin(members, eq(meetingInvites.memberId, members.id))
    .where(eq(meetingInvites.meetingId, rec.meetingId));
  // Context helps the model spell names; it is not an instruction.
  const prompt = `Meeting "${meeting?.title ?? ""}" (${meeting?.series ?? ""}) of a volunteer organisation. Participants: ${names.map((n) => n.name).join(", ")}.`;
  const languages = TRANSCRIBE_LANGUAGES[rec.languages ?? "sl"]?.codes ?? ["sl"];

  const claim = async (): Promise<RecordingSegment | null> => {
    const rows = await db.execute(sql`
      update recording_segments set transcript_status = 'running', transcript_started_at = now()
      where id = (
        select id from recording_segments
        where recording_id = ${recordingId}
          and (transcript_status = 'pending' or (transcript_status = 'running' and transcript_started_at < now() - ${STALE_PART}::interval))
        order by index limit 1 for update skip locked)
      returning id`);
    if (!rows.length) return null;
    const [seg] = await db.select().from(recordingSegments).where(eq(recordingSegments.id, (rows[0] as { id: number }).id));
    return seg;
  };

  let rateLimited = false;
  const worker = async () => {
    while (Date.now() < deadline && !rateLimited) {
      const seg = await claim();
      if (!seg) return;
      try {
        const audio = await store.download(seg.storagePath);
        const ext = seg.storagePath.split(".").pop() ?? "mp3";
        const result = await transcribe({ audio, fileName: `part-${seg.index}.${ext}`, languages, prompt });
        await db.update(recordingSegments).set({ transcriptStatus: "done", transcript: result.text, transcriptError: null }).where(eq(recordingSegments.id, seg.id));
        await db
          .update(recordings)
          .set({
            transcribedSeconds: sql`${recordings.transcribedSeconds} + ${Math.round(seg.durationMs / 1000)}`,
            transcribeModel: result.model,
            transcribeLeaseUntil: sql`now() + ${LEASE}::interval`,
          })
          .where(eq(recordings.id, recordingId));
      } catch (err) {
        const message = ((err as Error).message || "unknown error").slice(0, 300);
        await db.update(recordingSegments).set({ transcriptStatus: "failed", transcriptError: message }).where(eq(recordingSegments.id, seg.id));
        if (err instanceof RateLimitError) {
          // Every further request would be refused too: stop here and leave the parts not yet tried as failed
          // with the same message, so "Retry the failed parts" picks them up later. Finished parts are kept.
          rateLimited = true;
          await db
            .update(recordingSegments)
            .set({ transcriptStatus: "failed", transcriptError: message })
            .where(and(eq(recordingSegments.recordingId, recordingId), eq(recordingSegments.transcriptStatus, "pending")));
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await finalize(recordingId);
  }
  const [after] = await db.select({ status: recordings.status }).from(recordings).where(eq(recordings.id, recordingId));
  return after?.status === "transcribing" ? "continue" : "done";
}

/** All parts finished: join the transcript; otherwise just release the lease for the next run. */
async function finalize(recordingId: number) {
  const segs = await db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, recordingId)).orderBy(asc(recordingSegments.index));
  const open = segs.some((s) => s.transcriptStatus === "pending" || s.transcriptStatus === "running");
  if (open) {
    await db.update(recordings).set({ transcribeLeaseUntil: null }).where(eq(recordings.id, recordingId));
    return;
  }
  const failed = segs.filter((s) => s.transcriptStatus === "failed");
  const transcript = joinTranscripts(segs.map((s) => ({ index: s.index, durationMs: s.durationMs, text: s.transcript, failed: s.transcriptStatus === "failed" })));
  await db
    .update(recordings)
    .set({
      status: failed.length ? "failed" : "transcribed",
      error: failed.length ? `${failed.length} of ${segs.length} parts could not be transcribed: ${failed[0].transcriptError ?? "unknown error"}` : null,
      transcript,
      transcribeLeaseUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(recordings.id, recordingId));
}

export type Progress = { status: string; total: number; done: number; failed: number; error: string | null; needsRun: boolean };

/** For the progress poll. needsRun: transcribing, but no run holds the lease (finished its budget or crashed). */
export async function transcriptionProgress(member: Member, recordingId: number): Promise<Progress> {
  if (!member.isAdmin) throw new RecordingError("Only admins can transcribe recordings.");
  const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1);
  if (!rec) throw new RecordingError("Recording not found.");
  const segs = await db.select({ status: recordingSegments.transcriptStatus }).from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id));
  return {
    status: rec.status,
    total: segs.length,
    done: segs.filter((s) => s.status === "done").length,
    failed: segs.filter((s) => s.status === "failed").length,
    error: rec.error,
    needsRun: rec.status === "transcribing" && (!rec.transcribeLeaseUntil || rec.transcribeLeaseUntil < new Date()),
  };
}

/**
 * "Save as meeting notes": the (edited) transcript becomes a note of the meeting, so it shows up for
 * "Create tasks from notes". Tasks are never created from a transcript without this step.
 */
export async function saveTranscriptAsNotes(member: Member, recordingId: number, text: string): Promise<{ noteId: number; meetingId: number }> {
  if (!member.isAdmin) throw new RecordingError("Only admins can save transcripts as notes.");
  const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1);
  if (!rec) throw new RecordingError("Recording not found.");
  if (!["transcribed", "failed"].includes(rec.status)) throw new RecordingError("Transcribe the recording first.");
  const content = cleanNotes(text);
  if (!content) throw new RecordingError("The transcript is empty.");
  if (content.length > NOTES_MAX_CHARS) throw new RecordingError(`Notes can be at most ${NOTES_MAX_CHARS.toLocaleString("en-GB")} characters; this transcript has ${content.length.toLocaleString("en-GB")}. Shorten it first.`);
  const started = ljubljanaParts(rec.startedAt);
  return db.transaction(async (tx) => {
    const [note] = await tx
      .insert(meetingNotes)
      .values({
        meetingId: rec.meetingId,
        authorId: member.id,
        content,
        contentHash: hashNotes(content),
        fileName: `Transcript of the recording of ${started.date} ${started.time.slice(0, 5)}`,
      })
      .returning({ id: meetingNotes.id });
    await tx.update(recordings).set({ transcript: content, savedNoteId: note.id, updatedAt: new Date() }).where(eq(recordings.id, rec.id));
    return { noteId: note.id, meetingId: rec.meetingId };
  });
}
