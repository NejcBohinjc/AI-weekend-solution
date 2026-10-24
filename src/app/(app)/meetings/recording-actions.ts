"use server";

// Server actions for meeting recordings. Audio never passes through here (Vercel's ~4.5 MB body
// limit): the browser gets a signed upload URL, uploads to Supabase Storage itself, then confirms.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireMember } from "@/lib/auth";
import { transcribeEnabled } from "@/lib/ai/transcribe";
import { RecordingError, confirmSegment, createRecording, deleteRecording, finishRecording, playbackUrls, prepareSegmentUpload } from "@/lib/recordings/service";
import { runTranscription, saveTranscriptAsNotes, startTranscription, transcriptionProgress, type Progress } from "@/lib/recordings/transcription";
import { StorageError, storageConfigured } from "@/lib/storage/supabase";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function guarded<T>(what: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    if (err instanceof RecordingError || err instanceof StorageError) return { ok: false, error: err.message };
    console.error(`[recordings] ${what}:`, (err as Error).message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function needStorage() {
  if (!storageConfigured()) throw new RecordingError("Recording is not set up (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).");
}

export async function startRecordingAction(meetingId: number, source: "recorded" | "uploaded", fileName: string | null): Promise<Result<{ recordingId: number }>> {
  const me = await requireMember();
  return guarded("start", async () => {
    needStorage();
    const rec = await createRecording(me, meetingId, { source, fileName });
    revalidatePath(`/meetings/${meetingId}`);
    return { recordingId: rec.id };
  });
}

export async function segmentUploadUrlAction(recordingId: number, index: number, ext: string): Promise<Result<{ url: string }>> {
  const me = await requireMember();
  return guarded("upload link", async () => {
    needStorage();
    const { uploadUrl } = await prepareSegmentUpload(me, recordingId, index, ext);
    return { url: uploadUrl };
  });
}

export async function confirmSegmentAction(recordingId: number, index: number, ext: string, durationMs: number): Promise<Result<{ parts: number }>> {
  const me = await requireMember();
  return guarded("confirm", async () => {
    needStorage();
    const t = await confirmSegment(me, recordingId, { index, ext, durationMs });
    return { parts: t.parts };
  });
}

export async function finishRecordingAction(recordingId: number, meetingId: number): Promise<Result<{ removed: boolean }>> {
  const me = await requireMember();
  return guarded("finish", async () => {
    const r = await finishRecording(me, recordingId);
    revalidatePath(`/meetings/${meetingId}`);
    return r;
  });
}

export async function deleteRecordingAction(recordingId: number, meetingId: number): Promise<Result> {
  const me = await requireMember();
  return guarded("delete", async () => {
    needStorage();
    await deleteRecording(me, recordingId);
    revalidatePath(`/meetings/${meetingId}`);
    return {};
  });
}

export async function playbackUrlsAction(recordingId: number): Promise<Result<{ parts: { index: number; url: string | null; contentType: string; durationMs: number }[] }>> {
  const me = await requireMember();
  return guarded("playback", async () => {
    needStorage();
    return { parts: (await playbackUrls(me, recordingId)).map(({ index, url, contentType, durationMs }) => ({ index, url, contentType, durationMs })) };
  });
}

/** Transcription runs in the background after the response; the page polls progress. */
function runInBackground(recordingId: number) {
  after(async () => {
    try {
      await runTranscription(recordingId);
    } catch (err) {
      console.error("[recordings] transcription:", (err as Error).message);
    }
  });
}

export async function startTranscriptionAction(recordingId: number, meetingId: number, languages: string, onlyFailed: boolean): Promise<Result> {
  const me = await requireMember();
  return guarded("transcribe", async () => {
    needStorage();
    if (!transcribeEnabled()) throw new RecordingError("Transcription is not set up (OPENAI_API_KEY).");
    await startTranscription(me, recordingId, { languages, onlyFailed });
    runInBackground(recordingId);
    revalidatePath(`/meetings/${meetingId}`);
    return {};
  });
}

export async function transcriptionProgressAction(recordingId: number): Promise<Result<{ progress: Progress }>> {
  const me = await requireMember();
  return guarded("progress", async () => {
    const progress = await transcriptionProgress(me, recordingId);
    // The last run used its time budget (or crashed): continue with another one.
    if (progress.needsRun) runInBackground(recordingId);
    return { progress };
  });
}

export async function saveTranscriptAction(recordingId: number, text: string): Promise<Result<{ noteId: number }>> {
  const me = await requireMember();
  return guarded("save transcript", async () => {
    const { noteId, meetingId } = await saveTranscriptAsNotes(me, recordingId, text);
    revalidatePath(`/meetings/${meetingId}`);
    revalidatePath("/dashboard");
    return { noteId };
  });
}
