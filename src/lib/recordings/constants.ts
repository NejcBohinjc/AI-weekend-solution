// Meeting recordings: shared limits (used by the browser recorder and the server).

export const RECORDINGS_BUCKET = "meeting-recordings";
export const RECORDING_STATUSES = ["recording", "uploaded", "transcribing", "transcribed", "failed"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];
export const SEGMENT_STATUSES = ["pending", "running", "done", "failed"] as const;
export type SegmentTranscriptStatus = (typeof SEGMENT_STATUSES)[number];

/** Speech-quality MP3: mono, 16 kHz, 32 kbps (about 14 MB an hour). */
export const MP3_SAMPLE_RATE = 16_000;
export const MP3_KBPS = 32;
/** Each segment is uploaded as soon as it is finished, so a crash loses at most this much. */
export const SEGMENT_SECONDS = 10 * 60;
export const MAX_RECORDING_SECONDS = 3 * 60 * 60;
/** A segment is ~2.4 MB; anything far bigger is not one of ours. */
export const MAX_SEGMENT_BYTES = 24 * 1024 * 1024;

/** Imported files: these go up as they are when small enough for the transcription provider (25 MB). */
export const DIRECT_IMPORT_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", webm: "audio/webm" };
/** Accepted for import; ogg and large files are converted to MP3 segments in the browser first. */
export const IMPORT_EXTENSIONS = ["mp3", "m4a", "wav", "webm", "ogg"] as const;
export const MAX_DIRECT_IMPORT_BYTES = 24 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;

export const TRANSCRIBE_LANGUAGES: Record<string, { label: string; codes: string[] }> = {
  sl: { label: "Slovenian", codes: ["sl"] },
  "sl,en": { label: "Slovenian and English", codes: ["sl", "en"] },
  en: { label: "English", codes: ["en"] },
  auto: { label: "Detect automatically", codes: [] },
};
