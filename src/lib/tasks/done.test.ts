import assert from "node:assert/strict";
import { test } from "node:test";
import { completionFields, isReopen, reopenStatus } from "./done";

const now = new Date("2026-10-24T12:00:00Z");

test("finishing stamps the time and remembers the status; reopening clears both", () => {
  assert.deepEqual(completionFields({ status: "verification", statusBeforeDone: null }, "done", now), { completedAt: now, statusBeforeDone: "verification" });
  assert.deepEqual(completionFields({ status: "done", statusBeforeDone: "in_progress" }, "todo", now), { completedAt: null, statusBeforeDone: null });
  assert.equal(completionFields({ status: "todo", statusBeforeDone: null }, "in_progress", now), null);
  assert.equal(completionFields({ status: "done", statusBeforeDone: "todo" }, "done", now), null);
});

test("unticking goes back to the status before done, else in progress if started, else to do", () => {
  assert.equal(reopenStatus("verification", false), "verification");
  assert.equal(reopenStatus("todo", true), "todo");
  assert.equal(reopenStatus(null, true), "in_progress");
  assert.equal(reopenStatus(null, false), "todo");
  assert.equal(reopenStatus("done", false), "todo", "never back to done");
  assert.ok(isReopen("done", "in_progress") && !isReopen("todo", "done") && !isReopen("done", "done"));
});
