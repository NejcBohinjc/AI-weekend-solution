// Database test (local DATABASE_URL only) for "Create tasks from notes" with a mocked API call.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { aiTaskItems, aiTaskRuns, meetingInvites, meetingNotes, meetings, members, tasks } from "@/db/schema";
import type { ModelCall } from "./meeting-tasks";
import { createTasksFromNote, hashNotes } from "./meeting-tasks-run";

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");
let meetingId: number;
let zigaId: number;
let calls = 0;
let reply: unknown = { action_items: [] };
const fakeClaude: ModelCall = async () => {
  calls++;
  return { output: reply, model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 200 };
};

async function addNote(content: string) {
  const [n] = await db
    .insert(meetingNotes)
    .values({ meetingId, authorId: zigaId, content, contentHash: hashNotes(content) })
    .returning({ id: meetingNotes.id });
  return n.id;
}
const aiTasks = () => db.select().from(tasks).where(and(eq(tasks.sourceMeetingId, meetingId), eq(tasks.createdByAi, true)));

describe("create tasks from notes", { skip: !local && "needs a local DATABASE_URL" }, () => {
  before(async () => {
    [{ id: zigaId }] = await db.select({ id: members.id }).from(members).where(eq(members.email, "ziga.krajnc@sandbox.example"));
    [{ id: meetingId }] = await db
      .insert(meetings)
      .values({ uid: `ai-test-${Date.now()}@sandbox.example`, title: "AI test meeting", series: "Grants", startsAt: new Date("2026-10-28T15:30:00Z"), endsAt: new Date("2026-10-28T16:30:00Z") })
      .returning({ id: meetings.id });
    await db.insert(meetingInvites).values({ meetingId, memberId: zigaId });
  });
  after(async () => {
    const ids = (await aiTasks()).map((t) => t.id);
    if (ids.length) await db.delete(tasks).where(inArray(tasks.id, ids));
    await db.delete(meetings).where(eq(meetings.id, meetingId)); // cascades notes, runs, items, invites
    await closeDb();
  });

  test("creates assigned and unassigned AI tasks, marked as AI and unconfirmed", async () => {
    reply = {
      action_items: [
        { title: "Send the budget", assignee_email: "ziga.krajnc@sandbox.example", due_date: "2026-10-30", type: "Finance", quote: "Žiga sends the budget by Friday" },
        { title: "Book the room", assignee_email: "Marko", due_date: null, type: null, quote: "someone books the room" },
        { title: "", assignee_email: null, due_date: null, type: null, quote: "" }, // invalid: dropped
      ],
    };
    const noteId = await addNote("Žiga sends the budget by Friday. Someone books the room.");
    const r = await createTasksFromNote({ noteId, member: { id: zigaId, isAdmin: false }, call: fakeClaude });
    assert.ok(r.ok, r.error);
    assert.deepEqual([r.created.length, r.skipped, r.discarded, r.reused], [2, 0, 1, false]);
    const [budget, room] = (await aiTasks()).sort((a, b) => a.id - b.id);
    assert.deepEqual(
      [budget.assigneeId, budget.dueDate, budget.type, budget.createdById, budget.triggeredById, budget.aiConfirmedAt, budget.aiModel],
      [zigaId, "2026-10-30", "Finance", null, zigaId, null, "claude-sonnet-5-5"],
    );
    assert.equal(budget.sourceQuote, "Žiga sends the budget by Friday");
    assert.equal(room.assigneeId, null, "unknown person -> unassigned");
  });

  test("idempotent: the same notes again create nothing and do not call the API again", async () => {
    const noteId = await addNote("Žiga sends the budget by Friday. Someone books the room.");
    const before = calls;
    const r = await createTasksFromNote({ noteId, member: { id: zigaId, isAdmin: false }, call: fakeClaude });
    assert.deepEqual([r.ok, r.created.length, r.skipped, r.reused, calls - before], [true, 0, 2, true, 0]);
    assert.equal((await aiTasks()).length, 2);
  });

  test("a deleted AI task is not recreated; new notes add only new items", async () => {
    const [budget] = (await aiTasks()).filter((t) => t.title === "Send the budget");
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, budget.id));
    reply = {
      action_items: [
        { title: "send the BUDGET", assignee_email: "Žiga Krajnc", due_date: null, type: null, quote: "budget" }, // same item
        { title: "Write the report", assignee_email: "ziga.krajnc@sandbox.example", due_date: null, type: "Content", quote: "report" },
      ],
    };
    const noteId = await addNote("Updated notes: budget, and Žiga writes the report.");
    const r = await createTasksFromNote({ noteId, member: { id: zigaId, isAdmin: false }, call: fakeClaude });
    assert.deepEqual(r.created.map((c) => c.title), ["Write the report"]);
    assert.equal(r.skipped, 1);
    const live = await db.select().from(tasks).where(and(eq(tasks.sourceMeetingId, meetingId), isNull(tasks.deletedAt)));
    assert.deepEqual(live.map((t) => t.title).sort(), ["Book the room", "Write the report"]);
    assert.equal((await db.select().from(aiTaskItems).where(eq(aiTaskItems.meetingId, meetingId))).length, 3);
  });

  test("only invitees and admins can run it; a rate limit applies per member", async () => {
    const [other] = await db.select({ id: members.id }).from(members).where(eq(members.email, "eva.vidmar@sandbox.example"));
    const noteId = await addNote("Some other notes " + Date.now());
    assert.equal((await createTasksFromNote({ noteId, member: { id: other.id, isAdmin: false }, call: fakeClaude })).error, "Notes not found.");
    // Reach the hourly limit with recorded API runs.
    for (let i = 0; i < 5; i++) await db.insert(aiTaskRuns).values({ meetingId, notesHash: `x${i}`, triggeredById: zigaId, calledApi: true, ok: true });
    const limited = await createTasksFromNote({ noteId, member: { id: zigaId, isAdmin: false }, call: fakeClaude });
    assert.match(limited.error ?? "", /5 times an hour/);
  });
});
