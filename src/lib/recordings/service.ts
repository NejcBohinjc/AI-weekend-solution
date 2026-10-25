// Meeting recordings on the server: who may do what, and the bookkeeping of uploaded segments.
// Admins record, import, transcribe and delete; admins and the meeting's invitees can play recordings
// and read transcripts. The browser uploads each segment straight to Storage with a signed URL, then
// confirms it here; a confirm is idempotent (unique recording + index), so retries never duplicate.
import { and, asc, count, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { meetings, members, recordings, recordingSegments, type Recording, type RecordingSegment } from "@/db/schema";
import { canUseMeetingNotes } from "@/lib/ai/meeting-tasks-run";
import { supabaseStore, type ObjectStore } from "@/lib/storage/supabase";
import { DIRECT_IMPORT_TYPES, MAX_RECORDING_SECONDS, MAX_SEGMENT_BYTES, SEGMENT_SECONDS } from "./constants";

export type Member = { id: number; isAdmin: boolean };

/** A rule the request breaks; the message is safe to show. */
export class RecordingError extends Error {}

const SEGMENT_EXTENSIONS = Object.keys(DIRECT_IMPORT_TYPES); // mp3 for recordings, the original type for small imports
const MAX_SEGMENTS = Math.ceil(MAX_RECORDING_SECONDS / SEGMENT_SECONDS) + 2;

export function segmentPath(meetingId: number, recordingId: number, index: number, ext: string): string {
  return `meeting-${meetingId}/recording-${recordingId}/part-${String(index).padStart(3, "0")}.${ext}`;
}

function assertAdmin(member: Member) {
  if (!member.isAdmin) throw new RecordingError("Only admins can record, upload, transcribe or delete recordings.");
}

/** Admins and the meeting's invitees can play its recordings and read their transcripts. */
export function canListen(member: Member, meetingId: number): Promise<boolean> {
  return canUseMeetingNotes(member, meetingId);
}

async function recordingFor(member: Member, recordingId: number): Promise<Recording> {
  assertAdmin(member);
  const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1);
  if (!rec) throw new RecordingError("Recording not found.");
  return rec;
}

export async function createRecording(member: Member, meetingId: number, opts: { source?: "recorded" | "uploaded"; fileName?: string | null; now?: Date } = {}): Promise<Recording> {
  assertAdmin(member);
  const [meeting] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) throw new RecordingError("Meeting not found.");
  const [rec] = await db
    .insert(recordings)
    .values({ meetingId, startedById: member.id, startedAt: opts.now ?? new Date(), source: opts.source ?? "recorded", fileName: opts.fileName?.slice(0, 200) ?? null })
    .returning();
  return rec;
}

function checkSegment(index: number, ext: string) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_SEGMENTS) throw new RecordingError("Invalid part number.");
  if (!SEGMENT_EXTENSIONS.includes(ext)) throw new RecordingError("Unsupported audio type.");
}

/** A signed URL the browser uploads one segment to. Uploading the same part again overwrites it. */
export async function prepareSegmentUpload(member: Member, recordingId: number, index: number, ext: string, store: ObjectStore = supabaseStore) {
  const rec = await recordingFor(member, recordingId);
  checkSegment(index, ext);
  if (rec.status !== "recording") throw new RecordingError("This recording is already finished.");
  const path = segmentPath(rec.meetingId, rec.id, index, ext);
  return { path, uploadUrl: await store.signedUploadUrl(path) };
}

/**
 * Records an uploaded segment after checking it is really in Storage. Idempotent: confirming the same
 * part again updates that one row.
 */
export async function confirmSegment(
  member: Member,
  recordingId: number,
  part: { index: number; ext: string; durationMs: number },
  store: ObjectStore = supabaseStore,
): Promise<{ parts: number; durationMs: number }> {
  const rec = await recordingFor(member, recordingId);
  checkSegment(part.index, part.ext);
  if (rec.status !== "recording") throw new RecordingError("This recording is already finished.");
  const durationMs = Math.round(part.durationMs);
  // A recorded part is ~10 minutes; a small imported file is one part of any length up to the maximum.
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_RECORDING_SECONDS * 1000) throw new RecordingError("Invalid part length.");
  const path = segmentPath(rec.meetingId, rec.id, part.index, part.ext);
  const bytes = await store.size(path);
  if (bytes === null) throw new RecordingError("The upload has not arrived in storage.");
  if (bytes === 0 || bytes > MAX_SEGMENT_BYTES) throw new RecordingError("The uploaded part has an unexpected size.");
  const values = { recordingId: rec.id, index: part.index, storagePath: path, contentType: DIRECT_IMPORT_TYPES[part.ext], durationMs, bytes, uploadedAt: new Date() };
  await db
    .insert(recordingSegments)
    .values(values)
    .onConflictDoUpdate({ target: [recordingSegments.recordingId, recordingSegments.index], set: { storagePath: path, contentType: values.contentType, durationMs, bytes, uploadedAt: values.uploadedAt } });
  return totals(rec.id, true);
}

async function totals(recordingId: number, write: boolean) {
  const [t] = await db
    .select({ parts: count(), durationMs: sum(recordingSegments.durationMs) })
    .from(recordingSegments)
    .where(eq(recordingSegments.recordingId, recordingId));
  const result = { parts: Number(t?.parts ?? 0), durationMs: Number(t?.durationMs ?? 0) };
  if (write) await db.update(recordings).set({ durationMs: result.durationMs, updatedAt: new Date() }).where(eq(recordings.id, recordingId));
  return result;
}

/** Stop: the recording is complete with the parts uploaded so far. Without any part it is removed. */
export async function finishRecording(member: Member, recordingId: number, now = new Date()): Promise<{ removed: boolean }> {
  const rec = await recordingFor(member, recordingId);
  if (rec.status !== "recording") return { removed: false };
  const t = await totals(rec.id, false);
  if (t.parts === 0) {
    await db.delete(recordings).where(eq(recordings.id, rec.id));
    return { removed: true };
  }
  await db.update(recordings).set({ status: "uploaded", endedAt: now, durationMs: t.durationMs, updatedAt: now }).where(and(eq(recordings.id, rec.id), eq(recordings.status, "recording")));
  return { removed: false };
}

/** Deletes the audio files and the rows (segments cascade). */
export async function deleteRecording(member: Member, recordingId: number, store: ObjectStore = supabaseStore): Promise<void> {
  const rec = await recordingFor(member, recordingId);
  const segs = await db.select({ path: recordingSegments.storagePath }).from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id));
  await store.remove(segs.map((s) => s.path));
  await db.delete(recordings).where(eq(recordings.id, rec.id));
}

export type RecordingWithParts = Recording & { segments: RecordingSegment[]; startedByName: string | null };

/**
 * A meeting's recordings with their parts and who started them, in two parallel queries. NO access check:
 * the caller must already have established that the member is an admin or invited (the meeting page does,
 * and starts this query early to save a round trip). Everyone else goes through recordingsForMeeting().
 */
export async function recordingsOfMeeting(meetingId: number): Promise<RecordingWithParts[]> {
  const [recs, segs] = await Promise.all([
    db
      .select({ rec: recordings, startedByName: members.name })
      .from(recordings)
      .leftJoin(members, eq(recordings.startedById, members.id))
      .where(eq(recordings.meetingId, meetingId))
      .orderBy(asc(recordings.startedAt)),
    db
      .select({ seg: recordingSegments })
      .from(recordingSegments)
      .innerJoin(recordings, eq(recordingSegments.recordingId, recordings.id))
      .where(eq(recordings.meetingId, meetingId))
      .orderBy(asc(recordingSegments.index)),
  ]);
  return recs.map(({ rec, startedByName }) => ({ ...rec, startedByName, segments: segs.filter((s) => s.seg.recordingId === rec.id).map((s) => s.seg) }));
}

/** The meeting's recordings with their parts, for admins and invitees; nothing for anyone else. */
export async function recordingsForMeeting(member: Member, meetingId: number): Promise<RecordingWithParts[]> {
  if (!(await canListen(member, meetingId))) return [];
  return recordingsOfMeeting(meetingId);
}

/** Short-lived download links for every part, in order (admins and invitees only). */
export async function playbackUrls(member: Member, recordingId: number, store: ObjectStore = supabaseStore) {
  const [rec] = await db.select().from(recordings).where(eq(recordings.id, recordingId)).limit(1);
  if (!rec || !(await canListen(member, rec.meetingId))) throw new RecordingError("Recording not found.");
  const segs = await db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id)).orderBy(asc(recordingSegments.index));
  const urls = await store.signedDownloadUrls(
    segs.map((s) => s.storagePath),
    60 * 60,
  );
  return segs.map((s, i) => ({ index: s.index, url: urls[i], contentType: s.contentType, durationMs: s.durationMs, bytes: s.bytes }));
}
