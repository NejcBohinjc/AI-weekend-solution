import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRemaining, isLateNotice, needsGeneralTask, noticeDeadline, noticeHint } from "./absence";
import { effectiveState } from "./rules";

// Monday 26 Oct 2026, 18:00 Ljubljana (17:00 UTC, after the clock change on 25 Oct).
const start = new Date("2026-10-26T17:00:00Z");
const meeting = { startsAt: start, endsAt: new Date("2026-10-26T18:30:00Z") };

test("72-hour boundary: exactly 72 h before is on time, one millisecond later is a late notice", () => {
  const deadline = noticeDeadline(start);
  assert.equal(deadline.toISOString(), "2026-10-23T17:00:00.000Z", "72 real hours, across the DST change");
  assert.equal(isLateNotice(new Date(deadline.getTime()), start), false);
  assert.equal(isLateNotice(new Date(deadline.getTime() - 1), start), false);
  assert.equal(isLateNotice(new Date(deadline.getTime() + 1), start), true);
  assert.equal(isLateNotice(new Date("2026-10-26T16:59:00Z"), start), true);
});

test("the form shows the rule, the deadline in Ljubljana time and the remaining time", () => {
  const early = noticeHint(start, new Date("2026-10-22T13:00:00Z"));
  assert.equal(early.late, false);
  assert.match(early.text, /at least 72 h before the start/);
  assert.match(early.text, /Deadline: Fri, 23 Oct, 19:00 \(in 1 day 4 h\)/, "19:00 summer time in Ljubljana");
  const late = noticeHint(start, new Date("2026-10-24T17:30:00Z"));
  assert.equal(late.late, true);
  assert.match(late.text, /passed 1 day ago, so this will be a late notice/);
  assert.equal(formatRemaining(0), "0 min");
  assert.equal(formatRemaining(3 * 3_600_000 + 20 * 60_000), "3 h 20 min");
});

test("a late notice counts as unexcused until an admin accepts it", () => {
  const after = new Date("2026-10-27T12:00:00Z");
  assert.equal(effectiveState("excused", meeting, after, { lateNotice: false, lateDecision: null }), "excused");
  assert.equal(effectiveState("excused", meeting, after, { lateNotice: true, lateDecision: null }), "unexcused");
  assert.equal(effectiveState("excused", meeting, after, { lateNotice: true, lateDecision: "rejected" }), "unexcused");
  assert.equal(effectiveState("excused", meeting, after, { lateNotice: true, lateDecision: "accepted" }), "excused");
  assert.equal(effectiveState("excused", meeting, after), "excused", "callers without late info keep the old meaning");
});

test("which recorded absences ask for a general task (rules in lib/absence-rules.ts)", () => {
  assert.equal(needsGeneralTask("unexcused", null), "unexcused");
  assert.equal(needsGeneralTask("excused", { lateNotice: true, lateDecision: "rejected" }), "late notice not accepted");
  assert.equal(needsGeneralTask("excused", { lateNotice: true, lateDecision: null }), null);
  assert.equal(needsGeneralTask("excused", { lateNotice: false, lateDecision: null }), null);
  assert.equal(needsGeneralTask("present", null), null);
});
