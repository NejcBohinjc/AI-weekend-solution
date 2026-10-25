// Database test (runs on the *_test database that npm test sets up) for meeting recordings, with an
// in-memory store instead of Supabase and a mocked transcription provider: access rules, idempotent
// segment uploads, finishing, deleting, and transcription with a retry of the failed part only.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { meetingInvites, meetingNotes, meetings, members, recordings, recordingSegments } from "@/db/schema";
import { RateLimitError, type Transcriber } from "@/lib/ai/transcribe";
import { FakeStore } from "@/lib/storage/fake-store";
import { testDatabaseSkip } from "@/lib/test-db";
import { confirmSegment, createRecording, deleteRecording, finishRecording, playbackUrls, prepareSegmentUpload, recordingsForMeeting, segmentPath } from "./service";
import { runTranscription, saveTranscriptAsNotes, startTranscription, transcriptionProgress } from "./transcription";

const stamp = Date.now();
let admin: { id: number; isAdmin: boolean };
let invitee: { id: number; isAdmin: boolean };
let outsider: { id: number; isAdmin: boolean };
let meetingId: number;
const store = new FakeStore();

async function addMember(name: string, isAdmin = false) {
  const [m] = await db
    .insert(members)
    .values({ name, email: `${name.toLowerCase().replace(/\s/g, ".")}.${stamp}@sandbox.example`, tier: "Core", weeklyHours: 70, isAdmin })
    .returning({ id: members.id, isAdmin: members.isAdmin });
  return m;
}

/** What the browser does for one part: get a link, upload, confirm. */
async function uploadPart(recordingId: number, index: number, bytes = 2000, durationMs = 600_000) {
  const { path } = await prepareSegmentUpload(admin, recordingId, index, "mp3", store);
  store.put(path, bytes);
  return confirmSegment(admin, recordingId, { index, ext: "mp3", durationMs }, store);
}

describe("meeting recordings", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    admin = await addMember("Rec Admin", true);
    invitee = await addMember("Rec Invitee");
    outsider = await addMember("Rec Outsider");
    [{ id: meetingId }] = await db
      .insert(meetings)
      .values({ uid: `rec-${stamp}@sandbox.example`, title: "Grants", series: "Grants", startsAt: new Date("2026-10-14T15:00:00Z"), endsAt: new Date("2026-10-14T16:00:00Z") })
      .returning({ id: meetings.id });
    await db.insert(meetingInvites).values({ meetingId, memberId: invitee.id });
  });
  after(async () => {
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    await db.delete(members).where(inArray(members.id, [admin.id, invitee.id, outsider.id]));
    await closeDb();
  });

  test("only admins record; members cannot start, upload or confirm", async () => {
    await assert.rejects(createRecording(invitee, meetingId), /Only admins/);
    const rec = await createRecording(admin, meetingId);
    await assert.rejects(prepareSegmentUpload(invitee, rec.id, 0, "mp3", store), /Only admins/);
    await assert.rejects(confirmSegment(outsider, rec.id, { index: 0, ext: "mp3", durationMs: 1000 }, store), /Only admins/);
    await assert.rejects(prepareSegmentUpload(admin, rec.id, 0, "exe", store), /Unsupported/);
    await db.delete(recordings).where(eq(recordings.id, rec.id));
  });

  test("segment uploads are idempotent: a retried part is one row; a missing upload is refused", async () => {
    const rec = await createRecording(admin, meetingId);
    await uploadPart(rec.id, 0, 2000, 600_000);
    const again = await uploadPart(rec.id, 0, 2100, 600_500); // the same part sent again after a lost answer
    assert.deepEqual(again, { parts: 1, durationMs: 600_500 });
    await assert.rejects(confirmSegment(admin, rec.id, { index: 1, ext: "mp3", durationMs: 1000 }, store), /has not arrived/);
    const rows = await db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id));
    assert.deepEqual(rows.map((r) => [r.index, r.bytes, r.storagePath]), [[0, 2100, segmentPath(meetingId, rec.id, 0, "mp3")]]);
    await uploadPart(rec.id, 1, 900, 120_000);
    await finishRecording(admin, rec.id);
    const [done] = await db.select().from(recordings).where(eq(recordings.id, rec.id));
    assert.deepEqual([done.status, done.durationMs, !!done.endedAt, done.startedById], ["uploaded", 720_500, true, admin.id]);
    await assert.rejects(prepareSegmentUpload(admin, rec.id, 2, "mp3", store), /already finished/);
    assert.deepEqual(await finishRecording(admin, (await createRecording(admin, meetingId)).id), { removed: true }, "nothing uploaded: removed");
  });

  test("admins and invitees can list and play; other members cannot", async () => {
    const forAdmin = await recordingsForMeeting(admin, meetingId);
    const forInvitee = await recordingsForMeeting(invitee, meetingId);
    assert.equal(forAdmin.length, 1);
    assert.equal(forInvitee.length, 1);
    assert.equal(forInvitee[0].segments.length, 2);
    assert.deepEqual(await recordingsForMeeting(outsider, meetingId), []);
    const urls = await playbackUrls(invitee, forAdmin[0].id, store);
    assert.deepEqual(urls.map((u) => u.index), [0, 1]);
    assert.ok(urls.every((u) => u.url?.startsWith("https://storage.test/download/")));
    await assert.rejects(playbackUrls(outsider, forAdmin[0].id, store), /not found/);
  });

  test("transcription part by part; a failed part is retried on its own; the transcript is saved as notes only on request", async () => {
    process.env.TRANSCRIBE_API_KEY = "gsk-test";
    const [rec] = await recordingsForMeeting(admin, meetingId);
    const calls: string[] = [];
    let failPart1 = true;
    const transcribe: Transcriber = async ({ fileName, languages, prompt }) => {
      calls.push(fileName);
      assert.deepEqual(languages, ["sl"]);
      assert.match(prompt ?? "", /Rec Invitee/, "attendee names help spelling");
      if (fileName === "part-1.mp3" && failPart1) throw new Error("Transcription failed (500).");
      return { text: fileName === "part-0.mp3" ? "Pozdravljeni." : "Proračun je 2.000 €.", model: "gpt-transcribe" };
    };
    await assert.rejects(startTranscription(invitee, rec.id, { languages: "sl" }), /Only admins/);
    await startTranscription(admin, rec.id, { languages: "sl" });
    assert.equal(await runTranscription(rec.id, { store, transcribe, budgetMs: 0 }), "continue", "no time left: the next poll continues");
    assert.equal((await transcriptionProgress(admin, rec.id)).needsRun, true);
    assert.equal(await runTranscription(rec.id, { store, transcribe, concurrency: 1 }), "done");
    let [r] = await db.select().from(recordings).where(eq(recordings.id, rec.id));
    assert.equal(r.status, "failed");
    assert.match(r.error ?? "", /1 of 2 parts could not be transcribed/);
    assert.deepEqual(calls, ["part-0.mp3", "part-1.mp3"]);

    failPart1 = false;
    await startTranscription(admin, rec.id, { languages: "sl", onlyFailed: true });
    await runTranscription(rec.id, { store, transcribe });
    assert.deepEqual(calls, ["part-0.mp3", "part-1.mp3", "part-1.mp3"], "only the failed part again");
    [r] = await db.select().from(recordings).where(eq(recordings.id, rec.id));
    assert.equal(r.status, "transcribed");
    assert.equal(r.transcript, "[00:00:00] Pozdravljeni.\n\n[00:10:00] Proračun je 2.000 €.");
    assert.deepEqual([r.transcribedSeconds, r.transcribeModel], [601 + 120, "gpt-transcribe"]);
    assert.equal((await db.select().from(meetingNotes).where(eq(meetingNotes.meetingId, meetingId))).length, 0, "no notes until saved");

    await assert.rejects(saveTranscriptAsNotes(invitee, rec.id, "x"), /Only admins/);
    const { noteId } = await saveTranscriptAsNotes(admin, rec.id, r.transcript!.replace("Proračun", "Budget"));
    const [note] = await db.select().from(meetingNotes).where(eq(meetingNotes.id, noteId));
    assert.match(note.content, /Budget je 2.000 €/);
    assert.equal(note.authorId, admin.id);
    delete process.env.TRANSCRIBE_API_KEY;
  });

  test("a provider rate limit stops the run, keeps the parts already transcribed and is retryable", async () => {
    process.env.TRANSCRIBE_API_KEY = "gsk-test";
    const rec = await createRecording(admin, meetingId);
    for (const i of [0, 1, 2]) await uploadPart(rec.id, i);
    await finishRecording(admin, rec.id);
    const calls: string[] = [];
    let limited = true;
    const transcribe: Transcriber = async ({ fileName }) => {
      calls.push(fileName);
      if (fileName === "part-1.mp3" && limited) throw new RateLimitError(30);
      return { text: `Text of ${fileName}`, model: "whisper-large-v3" };
    };
    await startTranscription(admin, rec.id, { languages: "sl" });
    assert.equal(await runTranscription(rec.id, { store, transcribe, concurrency: 1 }), "done");
    assert.deepEqual(calls, ["part-0.mp3", "part-1.mp3"], "part 2 was not even tried: the provider would refuse it too");
    let segs = await db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id)).orderBy(recordingSegments.index);
    assert.deepEqual(segs.map((x) => x.transcriptStatus), ["done", "failed", "failed"]);
    assert.equal(segs[0].transcript, "Text of part-0.mp3", "the finished part is kept");
    assert.match(segs[1].transcriptError ?? "", /rate limit was reached \(it asks to wait 30 s\)/);
    assert.equal(segs[2].transcriptError, segs[1].transcriptError);
    let [r] = await db.select().from(recordings).where(eq(recordings.id, rec.id));
    assert.equal(r.status, "failed");
    assert.match(r.error ?? "", /2 of 3 parts could not be transcribed: The transcription provider's rate limit/);

    limited = false;
    await startTranscription(admin, rec.id, { languages: "sl", onlyFailed: true });
    await runTranscription(rec.id, { store, transcribe, concurrency: 1 });
    assert.deepEqual(calls, ["part-0.mp3", "part-1.mp3", "part-1.mp3", "part-2.mp3"], "only the two failed parts again");
    segs = await db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id)).orderBy(recordingSegments.index);
    assert.deepEqual(segs.map((x) => x.transcriptStatus), ["done", "done", "done"]);
    [r] = await db.select().from(recordings).where(eq(recordings.id, rec.id));
    assert.equal(r.status, "transcribed");
    assert.equal(r.transcript, "[00:00:00] Text of part-0.mp3\n\n[00:10:00] Text of part-1.mp3\n\n[00:20:00] Text of part-2.mp3");
    delete process.env.TRANSCRIBE_API_KEY;
  });

  test("another run holding the lease makes a second run step aside", async () => {
    process.env.TRANSCRIBE_API_KEY = "gsk-test";
    const [rec] = await recordingsForMeeting(admin, meetingId);
    await startTranscription(admin, rec.id, { languages: "auto" });
    await db.update(recordings).set({ transcribeLeaseUntil: new Date(Date.now() + 60_000) }).where(eq(recordings.id, rec.id));
    assert.equal(await runTranscription(rec.id, { store, transcribe: async () => ({ text: "", model: "m" }) }), "busy");
    delete process.env.TRANSCRIBE_API_KEY;
  });

  test("only admins delete; deleting removes the files and the rows", async () => {
    const [rec] = await recordingsForMeeting(admin, meetingId);
    await assert.rejects(deleteRecording(invitee, rec.id, store), /Only admins/);
    await deleteRecording(admin, rec.id, store);
    assert.deepEqual(store.removed.sort(), [segmentPath(meetingId, rec.id, 0, "mp3"), segmentPath(meetingId, rec.id, 1, "mp3")]);
    assert.equal((await db.select().from(recordingSegments).where(eq(recordingSegments.recordingId, rec.id))).length, 0);
  });
});
