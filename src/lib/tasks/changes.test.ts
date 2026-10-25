// Database test (runs on the *_test database that npm test sets up): tick and untick.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { members, taskEvents, tasks } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { applyTaskChanges, setTaskDone } from "./changes";

let memberId: number;
const load = async (id: number) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];
const newTask = async (status: "todo" | "in_progress" | "verification", title: string) =>
  (await db.insert(tasks).values({ title, status, assigneeId: memberId, source: "app", createdById: memberId }).returning())[0];

describe("tick and untick", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    const [m] = await db
      .insert(members)
      .values({ name: "Tick Test", email: `tick.test.${Date.now()}@sandbox.example`, tier: "GO!", weeklyHours: 4 })
      .returning({ id: members.id });
    memberId = m.id;
  });
  after(async () => {
    await db.delete(tasks).where(eq(tasks.assigneeId, memberId));
    await db.delete(members).where(eq(members.id, memberId));
    await closeDb();
  });

  test("tick stores the completion time and earlier status; untick restores it and records 'reopened'", async () => {
    const t = await newTask("verification", "Check the grant report");
    const t1 = new Date("2026-10-24T10:00:00Z");
    assert.equal(await setTaskDone(t, true, memberId, t1), "done");
    let row = await load(t.id);
    assert.deepEqual([row.status, row.completedAt?.toISOString(), row.statusBeforeDone], ["done", t1.toISOString(), "verification"]);

    assert.equal(await setTaskDone(row, true, memberId), null, "ticking a done task again changes nothing");
    assert.equal(await setTaskDone(row, false, memberId), "verification");
    row = await load(t.id);
    assert.deepEqual([row.status, row.completedAt, row.statusBeforeDone], ["verification", null, null]);

    const t2 = new Date("2026-10-25T10:00:00Z");
    await setTaskDone(row, true, memberId, t2);
    row = await load(t.id);
    assert.equal(row.completedAt?.toISOString(), t2.toISOString(), "done again: one completion time, the latest");

    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, t.id)).orderBy(asc(taskEvents.id));
    assert.deepEqual(
      events.map((e) => [e.kind, e.oldValue, e.newValue, e.actorId]),
      [
        ["updated", "Verifikacija", "Done", memberId],
        ["reopened", "Done", "Verifikacija", memberId],
        ["updated", "Verifikacija", "Done", memberId],
      ],
    );
  });

  test("untick without a remembered status: in progress if it was ever started, else to do", async () => {
    const started = await newTask("todo", "Started once");
    await applyTaskChanges(started, { status: "in_progress" }, memberId);
    await db.update(tasks).set({ status: "done", statusBeforeDone: null, completedAt: new Date() }).where(eq(tasks.id, started.id)); // e.g. done in the sheet before this feature
    assert.equal(await setTaskDone(await load(started.id), false, memberId), "in_progress");

    const never = await newTask("todo", "Never started");
    await db.update(tasks).set({ status: "done", statusBeforeDone: null, completedAt: new Date() }).where(eq(tasks.id, never.id));
    assert.equal(await setTaskDone(await load(never.id), false, memberId), "todo");
  });

  test("the edit form goes through the same rules", async () => {
    const t = await newTask("in_progress", "Edited to done");
    await applyTaskChanges(t, { status: "done", title: "Edited to done!" }, memberId);
    let row = await load(t.id);
    assert.ok(row.completedAt && row.statusBeforeDone === "in_progress");
    await applyTaskChanges(row, { status: "todo" }, memberId);
    row = await load(t.id);
    assert.deepEqual([row.completedAt, row.statusBeforeDone], [null, null]);
  });
});
