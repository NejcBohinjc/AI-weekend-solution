// Recording rules and small helpers. Pure (no I/O), so it is unit-tested (recordings.test.ts) and
// usable in the browser.
import { CHECKIN_OPENS_MINUTES, MAX_RECORDING_BYTES } from "./constants";

const MIN = 60_000;
type Times = { startsAt: Date; endsAt: Date; cancelled: boolean };

/** Recording in the room can start from 15 minutes before the start until the end. */
export function canStartRecording(m: Times, now: Date): boolean {
  return !m.cancelled && now.getTime() >= m.startsAt.getTime() - CHECKIN_OPENS_MINUTES * MIN && now <= m.endsAt;
}

/** A recording made in the room is accepted until 12 hours after the end (time to finish the upload). */
export function recordedUploadOpen(m: Times, now: Date): boolean {
  return !m.cancelled && now.getTime() >= m.startsAt.getTime() - CHECKIN_OPENS_MINUTES * MIN && now.getTime() <= m.endsAt.getTime() + 12 * 60 * MIN;
}

/** Admins upload a recording for a meeting that is over and has no recording yet (while it is on, the recorder is offered). */
export function canUploadRecording(m: Times, hasRecording: boolean, now: Date): boolean {
  return !m.cancelled && now >= m.endsAt && !hasRecording;
}

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** The media type without parameters, lowercase: "audio/webm;codecs=opus" -> "audio/webm". */
export function baseType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/** Audio of any kind, or a common video format (meeting recordings from Zoom, Meet, phones). */
export function isAcceptedType(contentType: string): boolean {
  const t = baseType(contentType);
  return /^audio\/[a-z0-9.+-]+$/.test(t) || ["video/mp4", "video/webm", "video/quicktime"].includes(t);
}

export function isVideo(contentType: string): boolean {
  return baseType(contentType).startsWith("video/");
}

/** File extension for storage: from the media type, else from the file name, else "bin". */
export function extensionFor(contentType: string, fileName?: string | null): string {
  const known = EXTENSIONS[baseType(contentType)];
  if (known) return known;
  const fromName = fileName?.match(/\.([a-z0-9]{1,5})$/i)?.[1].toLowerCase();
  return fromName ?? "bin";
}

/** Why a file cannot be stored, or null if it can. */
export function recordingFileProblem(file: { contentType: string; size: number }): string | null {
  if (!isAcceptedType(file.contentType)) return "Upload an audio file (or an MP4, WebM or MOV video).";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > MAX_RECORDING_BYTES) return `The file is larger than ${formatBytes(MAX_RECORDING_BYTES)}.`;
  return null;
}

/** "18.2 MB", "640 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "1:02:05" for a running recording. */
export function clockFromSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "47 min", "1 h 5 min", "45 s" */
export function formatSeconds(total: number): string {
  const s = Math.round(total);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}

/**
 * A single "bytes=start-end" range (what audio and video players ask for when seeking), clamped to
 * the file. null: no range asked; "invalid": cannot be served (answer 416).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return "invalid";
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2])); // last N bytes
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "invalid" : { start, end };
}
