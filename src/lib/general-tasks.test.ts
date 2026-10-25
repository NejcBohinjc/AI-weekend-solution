// Database test (runs on the *_test database that npm test sets up): general tasks never become done (one
// person holds one at a time, and marking it done frees it); a missed meeting asks the member to pick one;
// notifications reach only their own member.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { attendance, generalTaskRequests, meetingInvites, meetings, members, notifications, taskEvents, tasks } from "@/db/schema";
import { assignGeneralTask, followUpAbsence, pickGeneralTask, sweepAbsenceFollowUps } from "@/lib/general-tasks";
import { listNotifications, readNotification } from "@/lib/notifications";
import { applyTaskChanges, setTaskDone, TaskRuleError } from "@/lib/tasks/changes";
import { testDatabaseSkip } from "@/lib/test-db";

let ana: number; // member who misses the meeting
let bor: number; // another member
let admin: number;
let meetingId: number;
let general: typeof tasks.$inferSelect;
const stamp = Date.now();

async function record(state: "present" | "unexcused" | "excused", late?: { lateNotice: boolean; lateDecision: "accepted" | "rejected" | null }) {
  await db
    .insert(attendance)
    .values({ meetingId, memberId: ana, state, source: "admin", setById: admin, ...late })
    .onConflictDoUpdate({ target: [attendance.meetingId, attendance.memberId], set: { state, lateNotice: late?.lateNotice ?? false, lateDecision: late?.lateDecision ?? null } });
}
const request = async () => (await db.select().from(generalTaskRequests).where(and(eq(generalTaskRequests.memberId, ana), eq(generalTaskRequests.meetingId, meetingId))))[0];

describe("general tasks and missed meetings", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    const people = await db
      .insert(members)
      .values([
        { name: "Ana Gen", email: `ana.gen.${stamp}@sandbox.example`, tier: "GO!", weeklyHours: 4 },
        { name: "Bor Gen", email: `bor.gen.${stamp}@sandbox.example`, tier: "GO!", weeklyHours: 4 },
        { name: "Admin Gen", email: `admin.gen.${stamp}@sandbox.example`, tier: "Core", weeklyHours: 70, isAdmin: true },
      ])
      .returning({ id: members.id });
    [ana, bor, admin] = people.map((p) => p.id);
    [{ id: meetingId }] = await db
      .insert(meetings)
      .values({ uid: `gen-${stamp}@sandbox.example`, title: "Grants meeting", series: "Grants", startsAt: new Date("2026-10-14T15:30:00Z"), endsAt: new Date("2026-10-14T16:30:00Z") })
      .returning({ id: meetings.id });
    await db.insert(meetingInvites).values([{ meetingId, memberId: ana }, { meetingId, memberId: bor }]);
    [general] = await db.insert(tasks).values({ kind: "general", title: "Help with research", status: "todo", source: "app", createdById: admin }).returning();
  });
  after(async () => {
    await db.delete(tasks).where(eq(tasks.id, general.id));
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    for (const id of [ana, bor, admin]) await db.delete(members).where(eq(members.id, id));
    await closeDb();
  });

  test("a general task is never done: the edit form refuses; a tick while nobody holds it changes nothing", async () => {
    assert.equal(await setTaskDone(general, true, admin), null);
    await assert.rejects(applyTaskChanges(general, { status: "done" }, admin), TaskRuleError);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, general.id));
    assert.equal(row.status, "todo");
    assert.equal(row.completedAt, null);
  });

  test("an unexcused absence asks once, with a notification only for that member", async () => {
    await record("unexcused");
    assert.equal(await followUpAbsence(ana, meetingId), "requested");
    assert.equal(await followUpAbsence(ana, meetingId), "none", "not asked twice");
    const mine = await listNotifications(ana);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].text, "You missed Grants meeting on Wed, 14 Oct. Pick a task from the general task list.");
    assert.equal(mine[0].link, "/tasks?tab=general");
    assert.equal((await listNotifications(bor)).length, 0, "nobody else sees it");
    assert.equal(await readNotification(bor, mine[0].id), null, "another member cannot open it");
    assert.ok(await readNotification(ana, mine[0].id));
  });

  test("changing the absence cancels the request; recording it again asks again", async () => {
    await record("present");
    assert.equal(await followUpAbsence(ana, meetingId), "cancelled");
    const r = await request();
    assert.deepEqual(await pickGeneralTask(ana, r.id, general.id), { ok: false, error: "This is no longer needed: your attendance was changed." });
    await record("unexcused");
    assert.equal(await followUpAbsence(ana, meetingId), "requested");
    assert.equal((await listNotifications(ana)).length, 2);
  });

  test("one tap picks a general task; only the member's own request; never twice", async () => {
    const r = await request();
    assert.deepEqual(await pickGeneralTask(bor, r.id, general.id), { ok: false, error: "Nothing to pick a task for." });
    assert.deepEqual(await pickGeneralTask(ana, r.id, general.id), { ok: true });
    assert.deepEqual(await pickGeneralTask(ana, r.id, general.id), { ok: false, error: "You already picked a task for this meeting." });
    const events = await db.select().from(taskEvents).where(and(eq(taskEvents.taskId, general.id), eq(taskEvents.kind, "picked")));
    assert.equal(events.length, 1);
    assert.equal(events[0].newValue, "Ana Gen picked this after missing “Grants meeting”");
    assert.equal(await followUpAbsence(ana, meetingId), "none", "already picked: nothing more");
    const [row] = await db.select().from(tasks).where(eq(tasks.id, general.id));
    assert.equal(row.assigneeId, ana, "picking makes it hers");
  });

  test("one person at a time; marking it done frees it (still to do) with history; admins assign it", async () => {
    // Bor also missed a meeting, but the task is Ana's until she has done it.
    const [borRequest] = await db.insert(generalTaskRequests).values({ memberId: bor, meetingId, reason: "unexcused" }).returning();
    assert.deepEqual(await pickGeneralTask(bor, borRequest.id, general.id), { ok: false, error: "Someone else is doing that task right now. Pick another one." });

    const [held] = await db.select().from(tasks).where(eq(tasks.id, general.id));
    assert.equal(await setTaskDone(held, true, ana), "todo");
    let [row] = await db.select().from(tasks).where(eq(tasks.id, general.id));
    assert.deepEqual([row.assigneeId, row.status, row.completedAt], [null, "todo", null], "unassigned and not done");
    const [done] = await db.select().from(taskEvents).where(and(eq(taskEvents.taskId, general.id), eq(taskEvents.kind, "completed")));
    assert.equal(done.newValue, "Ana Gen finished it; it is free for the next person");
    assert.equal(await setTaskDone(row, true, ana), null, "a second tick does nothing");

    // Free again: Bor can pick it now.
    assert.deepEqual(await pickGeneralTask(bor, borRequest.id, general.id), { ok: true });
    [row] = await db.select().from(tasks).where(eq(tasks.id, general.id));
    assert.equal(row.assigneeId, bor);

    // Admins move it to someone else or free it, with history.
    assert.equal(await assignGeneralTask(general.id, ana, admin), "saved");
    assert.equal(await assignGeneralTask(general.id, ana, admin), "unchanged");
    const moves = await db.select().from(taskEvents).where(and(eq(taskEvents.taskId, general.id), eq(taskEvents.field, "assigneeId")));
    assert.deepEqual([moves.at(-1)?.oldValue, moves.at(-1)?.newValue], ["Bor Gen", "Ana Gen"]);
    assert.equal(await assignGeneralTask(general.id, null, admin), "saved");
    [row] = await db.select().from(tasks).where(eq(tasks.id, general.id));
    assert.equal(row.assigneeId, null);
  });

  test("a meeting that has not ended yet asks nothing; the sweep asks once it is over", async () => {
    const [future] = await db
      .insert(meetings)
      .values({ uid: `gen-future-${stamp}@sandbox.example`, title: "Future meeting", series: "Grants", startsAt: new Date("2026-11-04T15:30:00Z"), endsAt: new Date("2026-11-04T16:30:00Z") })
      .returning({ id: meetings.id });
    await db.insert(attendance).values({ meetingId: future.id, memberId: bor, state: "excused", lateNotice: true, lateDecision: "rejected", source: "self", setById: bor });
    assert.equal(await followUpAbsence(bor, future.id, new Date("2026-11-03T12:00:00Z")), "none", "decided before the meeting: not asked yet");
    assert.equal(await sweepAbsenceFollowUps(new Date("2026-11-03T12:00:00Z")), 0);
    assert.equal(await sweepAbsenceFollowUps(new Date("2026-11-04T17:00:00Z")), 1, "asked once the meeting has ended");
    assert.equal(await sweepAbsenceFollowUps(new Date("2026-11-04T18:00:00Z")), 0, "only once");
    assert.match((await listNotifications(bor))[0].text, /^You missed Future meeting on Wed, 4 Nov\./);
    await db.delete(meetings).where(eq(meetings.id, future.id));
    await db.delete(notifications).where(eq(notifications.memberId, bor));
  });

  test("late notices: pending asks nothing; not accepted asks for a general task (rules file)", async () => {
    await db.delete(generalTaskRequests).where(eq(generalTaskRequests.memberId, ana));
    await record("excused", { lateNotice: true, lateDecision: null });
    assert.equal(await followUpAbsence(ana, meetingId), "none");
    await record("excused", { lateNotice: true, lateDecision: "rejected" });
    assert.equal(await followUpAbsence(ana, meetingId), "requested");
    assert.equal((await request()).reason, "late notice not accepted");
    await db.delete(notifications).where(eq(notifications.memberId, ana));
  });
});
