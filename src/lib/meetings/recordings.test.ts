import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canStartRecording,
  canUploadRecording,
  clockFromSeconds,
  extensionFor,
  formatBytes,
  formatSeconds,
  isAcceptedType,
  parseRange,
  recordedUploadOpen,
  recordingFileProblem,
} from "./recordings";

// Monday 26 Oct 2026, 18:00-19:30 in Ljubljana.
const m = { startsAt: new Date("2026-10-26T17:00:00Z"), endsAt: new Date("2026-10-26T18:30:00Z"), cancelled: false };
const at = (iso: string) => new Date(iso);

test("recording in the room: from 15 minutes before the start until the end", () => {
  assert.equal(canStartRecording(m, at("2026-10-26T16:44:00Z")), false);
  assert.equal(canStartRecording(m, at("2026-10-26T16:45:00Z")), true);
  assert.equal(canStartRecording(m, at("2026-10-26T18:30:00Z")), true);
  assert.equal(canStartRecording(m, at("2026-10-26T18:31:00Z")), false);
  assert.equal(canStartRecording({ ...m, cancelled: true }, at("2026-10-26T17:30:00Z")), false);
  // The upload of a room recording may finish up to 12 hours after the end.
  assert.equal(recordedUploadOpen(m, at("2026-10-27T06:30:00Z")), true);
  assert.equal(recordedUploadOpen(m, at("2026-10-27T06:31:00Z")), false);
});

test("admins upload a recording once the meeting is over, if it has none", () => {
  assert.equal(canUploadRecording(m, false, at("2026-10-26T17:00:00Z")), false);
  assert.equal(canUploadRecording(m, false, at("2026-10-26T18:29:00Z")), false);
  assert.equal(canUploadRecording(m, false, at("2026-10-26T18:30:00Z")), true);
  assert.equal(canUploadRecording(m, false, at("2026-11-20T10:00:00Z")), true);
  assert.equal(canUploadRecording(m, true, at("2026-11-20T10:00:00Z")), false);
  assert.equal(canUploadRecording({ ...m, cancelled: true }, false, at("2026-11-20T10:00:00Z")), false);
});

test("accepts audio and common video files, up to 500 MB", () => {
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/mpeg", "audio/x-m4a", "AUDIO/WAV", "video/mp4", "video/quicktime"]) {
    assert.equal(isAcceptedType(t), true, t);
  }
  for (const t of ["application/pdf", "video/x-msvideo", "text/plain", ""]) assert.equal(isAcceptedType(t), false, t);
  assert.equal(recordingFileProblem({ contentType: "audio/mpeg", size: 10 }), null);
  assert.equal(recordingFileProblem({ contentType: "audio/mpeg", size: 0 }), "The file is empty.");
  assert.match(recordingFileProblem({ contentType: "audio/mpeg", size: 600 * 1024 * 1024 })!, /larger than 500\.0 MB/);
  assert.match(recordingFileProblem({ contentType: "image/png", size: 10 })!, /audio file/);
});

test("file extensions come from the media type, else the file name", () => {
  assert.equal(extensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(extensionFor("audio/mp4"), "m4a");
  assert.equal(extensionFor("video/quicktime", "Meeting.MOV"), "mov");
  assert.equal(extensionFor("audio/x-unknown", "rec.OPUS"), "opus");
  assert.equal(extensionFor("audio/x-unknown", "../../etc/passwd"), "bin");
});

test("formats sizes and durations", () => {
  assert.equal(formatBytes(18.2 * 1024 * 1024), "18.2 MB");
  assert.equal(formatBytes(640 * 1024), "640 KB");
  assert.equal(formatSeconds(45), "45 s");
  assert.equal(formatSeconds(47 * 60), "47 min");
  assert.equal(formatSeconds(65 * 60), "1 h 5 min");
  assert.equal(clockFromSeconds(3725), "1:02:05");
});

test("reads byte ranges the way media players ask for them", () => {
  assert.equal(parseRange(null, 1000), null);
  assert.deepEqual(parseRange("bytes=0-", 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange("bytes=100-199", 1000), { start: 100, end: 199 });
  assert.deepEqual(parseRange("bytes=900-5000", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.equal(parseRange("bytes=1000-", 1000), "invalid");
  assert.equal(parseRange("bytes=5-1", 1000), "invalid");
  assert.equal(parseRange("items=0-1", 1000), "invalid");
});
