// Database test (runs on the *_test database that npm test sets up) for "Summarise", with a mocked API
// call: admin only, stored on the newest note, regenerate, stale detection, Ask using it, list icons.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { aiQuestions, meetingInvites, meetingNotes, meetings, members, recordings } from "@/db/schema";
import { meetingMedia } from "@/lib/meetings/media";
import { testDatabaseSkip } from "@/lib/test-db";
import { askAboutMeeting } from "./meeting-qa-run";
import { summariseMeeting, summaryOfMeeting } from "./meeting-summary-run";
import type { ModelCall } from "./meeting-tasks";
import { hashNotes } from "./meeting-tasks-run";

const stamp = Date.now();
let admin: { id: number; isAdmin: boolean };
let invitee: { id: number; isAdmin: boolean };
let meetingId: number;
let otherMeetingId: number;
const BODY = "Ana: the budget is 2.000 €. Marko books the room for the launch. We still need a speaker. ".repeat(6);
let sent = "";
let calls = 0;
const summaryCall = (bullets: string[]): ModelCall => async ({ user }) => {
  calls++;
  sent = user;
  return { output: { too_short: false, bullets }, model: "claude-test" };
};
const addNote = async (content: string, at: Date) => {
  const [n] = await db.insert(meetingNotes).values({ meetingId, content, contentHash: hashNotes(content + at.getTime()), createdAt: at }).returning({ id: meetingNotes.id });
  return n.id;
};

describe("meeting summary", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    const rows = await db
      .insert(members)
      .values([
        { name: "Sum Admin", email: `sum.admin.${stamp}@sandbox.example`, tier: "Core", weeklyHours: 70, isAdmin: true },
        { name: "Sum Invitee", email: `sum.invitee.${stamp}@sandbox.example`, tier: "Impact", weeklyHours: 10 },
      ])
      .returning({ id: members.id, isAdmin: members.isAdmin });
    [admin, invitee] = rows;
    [{ id: meetingId }, { id: otherMeetingId }] = await db
      .insert(meetings)
      .values([0, 1].map((i) => ({ uid: `summary-${i}-${stamp}@sandbox.example`, title: `Summary test ${i}`, series: "Grants", startsAt: new Date("2026-10-14T15:00:00Z"), endsAt: new Date("2026-10-14T16:00:00Z") })))
      .returning({ id: meetings.id });
    await db.insert(meetingInvites).values({ meetingId, memberId: invitee.id });
  });
  after(async () => {
    await db.delete(aiQuestions).where(inArray(aiQuestions.memberId, [admin.id, invitee.id]));
    await db.delete(meetings).where(inArray(meetings.id, [meetingId, otherMeetingId]));
    await db.delete(members).where(inArray(members.id, [admin.id, invitee.id]));
    await closeDb();
  });

  test("only admins summarise; a meeting without notes, or with too short notes, gets a clear message and no API call", async () => {
    const before = calls;
    assert.deepEqual(await summariseMeeting({ meetingId, admin: invitee, call: summaryCall(["x"]) }), { ok: false, error: "Only admins can summarise a meeting." });
    assert.deepEqual(await summariseMeeting({ meetingId, admin, call: summaryCall(["x"]) }), { ok: false, error: "This meeting has no notes yet." });
    await addNote("Short.", new Date("2026-10-14T17:00:00Z"));
    const short = await summariseMeeting({ meetingId, admin, call: summaryCall(["x"]) });
    assert.ok(!short.ok && /too short/.test(short.error));
    assert.equal(calls, before, "the API was never called");
    assert.equal(await summaryOfMeeting(meetingId), null);
    await db.delete(meetingNotes).where(eq(meetingNotes.meetingId, meetingId));
  });

  test("the summary is stored on the newest note with the model and time; regenerating replaces it", async () => {
    const older = await addNote(BODY, new Date("2026-10-14T17:00:00Z"));
    const newer = await addNote(BODY + " Second notes.", new Date("2026-10-14T18:00:00Z"));
    const at = new Date("2026-10-14T19:00:00Z");
    const r = await summariseMeeting({ meetingId, admin, call: summaryCall(["The budget is 2.000 €.", "Open: who is the speaker?"]), now: at });
    assert.deepEqual(r, { ok: true, text: "- The budget is 2.000 €.\n- Open: who is the speaker?", at });
    assert.match(sent, /<meeting_notes>[\s\S]*Second notes[\s\S]*<\/meeting_notes>/, "all of the meeting's notes were sent, newest first");
    const stored = await summaryOfMeeting(meetingId);
    assert.deepEqual([stored!.noteId, stored!.model, stored!.at, stored!.stale], [newer, "claude-test", at, false]);
    const [row] = await db.select().from(meetingNotes).where(eq(meetingNotes.id, older));
    assert.equal(row.summary, null, "older notes carry none");

    const again = await summariseMeeting({ meetingId, admin, call: summaryCall(["Only the speaker is open."]), now: new Date("2026-10-14T20:00:00Z") });
    assert.ok(again.ok);
    assert.equal((await summaryOfMeeting(meetingId))!.text, "- Only the speaker is open.");
  });

  test("notes added after the summary make it stale; summarising again moves it to the newest note; a failing API keeps the old one", async () => {
    const newest = await addNote(BODY + " Third notes.", new Date("2026-10-14T21:00:00Z"));
    assert.equal((await summaryOfMeeting(meetingId))!.stale, true);
    const failing: ModelCall = async () => {
      throw new Error("overloaded");
    };
    const bad = await summariseMeeting({ meetingId, admin, call: failing });
    assert.ok(!bad.ok && /overloaded/.test(bad.error));
    assert.equal((await summaryOfMeeting(meetingId))!.text, "- Only the speaker is open.", "the earlier summary is still there");
    await summariseMeeting({ meetingId, admin, call: summaryCall(["Everything is covered."]), now: new Date("2026-10-14T22:00:00Z") });
    const now = await summaryOfMeeting(meetingId);
    assert.deepEqual([now!.noteId, now!.stale], [newest, false]);
    assert.equal((await db.select().from(meetingNotes).where(eq(meetingNotes.meetingId, meetingId))).filter((n) => n.summary).length, 1);
  });

  test("Ask about a meeting gets the summary as extra context, only for its own meeting", async () => {
    let user = "";
    const ask: ModelCall = async (args) => {
      user = args.user;
      return { output: { found: true, answer: "Covered.", quotes: ["Third notes."], not_found_message: "" }, model: "claude-test" };
    };
    const r = await askAboutMeeting({ member: invitee, question: "What is covered?", meetingId, call: ask });
    assert.ok(r.kind === "answer" && r.found && r.quotes[0] === "Third notes.");
    assert.match(user, /<meeting_summary>\n- Everything is covered\.\n<\/meeting_summary>/);
    // A summary from another meeting never appears; and an answer quoting only the summary does not count.
    await db.insert(meetingInvites).values({ meetingId: otherMeetingId, memberId: invitee.id });
    await db.insert(meetingNotes).values({ meetingId: otherMeetingId, content: "Only the notes of the other meeting.", contentHash: hashNotes("other" + stamp) });
    await askAboutMeeting({ member: invitee, question: "What?", meetingId: otherMeetingId, call: ask });
    assert.ok(!user.includes("meeting_summary") && !user.includes("Everything is covered"));
    const sneaky: ModelCall = async () => ({ output: { found: true, answer: "x", quotes: ["Everything is covered."], not_found_message: "Not in the notes." }, model: "m" });
    const s = await askAboutMeeting({ member: invitee, question: "What is covered?", meetingId, call: sneaky });
    assert.ok(s.kind === "answer" && !s.found && s.quotes.length === 0, "a quote from the summary is not a quote from the notes");
  });

  test("list icons: recording, transcript and summary are marked per meeting", async () => {
    let media = await meetingMedia([meetingId, otherMeetingId]);
    assert.deepEqual(media.get(meetingId), { recording: false, transcript: false, summary: true });
    assert.equal(media.get(otherMeetingId), undefined);
    await db.insert(recordings).values({ meetingId: otherMeetingId, startedById: admin.id, status: "transcribed", transcript: "Text." });
    await db.insert(recordings).values({ meetingId, startedById: admin.id, status: "recording" });
    media = await meetingMedia([meetingId, otherMeetingId]);
    assert.deepEqual(media.get(otherMeetingId), { recording: true, transcript: true, summary: false });
    assert.equal(media.get(meetingId)!.recording, false, "a recording still in progress is not a recording yet");
  });
});
