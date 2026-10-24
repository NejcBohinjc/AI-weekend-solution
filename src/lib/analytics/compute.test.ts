import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAnalytics, type Data } from "./compute";
import { weeklyHours, type Entry } from "./test-helpers";

// Wednesday 28 Oct 2026, noon in Ljubljana (UTC+1 after the clock change on 25 Oct).
const now = new Date("2026-10-28T11:00:00Z");
const at = (iso: string) => new Date(iso);
const h = (memberId: number, startIso: string, hours: number) => ({ memberId, startedAt: at(startIso), endedAt: new Date(at(startIso).getTime() + hours * 3_600_000) });

const entries: Entry[] = [
  h(1, "2026-10-26T08:00:00Z", 30), // this week: 30 of 70, pro-rated target ~ 70*0.36*0.75 -> on track
  h(2, "2026-10-26T08:00:00Z", 0.5), // this week: behind
  // last 4 weeks: Bor under 50% every week, Cene at target
  ...["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].flatMap((d) => [h(2, `${d}T08:00:00Z`, 1), h(3, `${d}T08:00:00Z`, 10), h(1, `${d}T08:00:00Z`, 70)]),
];

const data: Data = {
  now,
  members: [
    { id: 1, name: "Ana", tier: "Core", weeklyHours: 70, active: true },
    { id: 2, name: "Bor", tier: "GO!", weeklyHours: 4, active: true },
    { id: 3, name: "Cene", tier: "Impact", weeklyHours: 10, active: true },
    { id: 4, name: "Gone", tier: "Impact", weeklyHours: 10, active: false },
  ],
  hours: weeklyHours(entries, now),
  firstEntryAt: new Date(Math.min(...entries.map((e) => e.startedAt.getTime()))),
  anyAiTask: true,
  meetings: [
    { id: 10, title: "Grants", series: "Grants", startsAt: at("2026-10-01T15:00:00Z"), endsAt: at("2026-10-01T16:00:00Z"), status: "confirmed" },
    { id: 11, title: "Grants", series: "Grants", startsAt: at("2026-10-15T15:00:00Z"), endsAt: at("2026-10-15T16:00:00Z"), status: "confirmed" },
    { id: 12, title: "Community", series: "Community", startsAt: at("2026-10-26T17:00:00Z"), endsAt: at("2026-10-26T18:00:00Z"), status: "confirmed" },
    { id: 13, title: "Future", series: "Community", startsAt: at("2026-11-02T17:00:00Z"), endsAt: at("2026-11-02T18:00:00Z"), status: "confirmed" },
  ],
  invites: [10, 11, 12, 13].flatMap((meetingId) => [1, 2, 3].map((memberId) => ({ meetingId, memberId }))),
  attendance: [
    { meetingId: 10, memberId: 1, state: "present" },
    { meetingId: 11, memberId: 1, state: "remote" },
    { meetingId: 12, memberId: 1, state: "present" },
    { meetingId: 10, memberId: 3, state: "excused" },
    { meetingId: 11, memberId: 3, state: "present" },
    { meetingId: 12, memberId: 3, state: "present" },
    // Bor: no answers -> unexcused for the past meetings
  ],
  tasks: [
    // Done this week (it was done, reopened and done again: counted once, at the latest time).
    { id: 100, assigneeId: 1, status: "done", createdAt: at("2026-10-26T09:00:00Z"), completedAt: at("2026-10-27T10:00:00Z"), createdByAi: false, aiConfirmedAt: null, deletedAt: null },
    // Unconfirmed AI task, done: not counted.
    { id: 101, assigneeId: 3, status: "done", createdAt: at("2026-10-26T09:00:00Z"), completedAt: at("2026-10-27T09:00:00Z"), createdByAi: true, aiConfirmedAt: null, deletedAt: null },
    { id: 102, assigneeId: 3, status: "done", createdAt: at("2026-10-19T09:00:00Z"), completedAt: at("2026-10-21T09:00:00Z"), createdByAi: true, aiConfirmedAt: at("2026-10-20T09:00:00Z"), deletedAt: null },
    // Deleted: not counted.
    { id: 103, assigneeId: 1, status: "done", createdAt: at("2026-10-19T09:00:00Z"), completedAt: at("2026-10-21T09:00:00Z"), createdByAi: false, aiConfirmedAt: null, deletedAt: at("2026-10-27T09:00:00Z") },
    // Done last week, then reopened: completed_at cleared, no longer counted anywhere.
    { id: 104, assigneeId: 2, status: "in_progress", createdAt: at("2026-10-19T09:00:00Z"), completedAt: null, createdByAi: false, aiConfirmedAt: null, deletedAt: null },
  ],
  taskActivity: [{ memberId: 2, at: at("2026-10-27T09:00:00Z") }],
};

test("tiles: active members, at target, attendance rate, finished this week", () => {
  const a = computeAnalytics(data, { tier: null, series: null, range: "4w" });
  assert.deepEqual(a.tiles.active, { n: 3, of: 3 }, "inactive members are not counted; Bor is active through a task change");
  assert.deepEqual(a.tiles.atTarget, { n: 1, of: 3 }, "Ana on track; Bor behind; Cene has no hours yet this week");
  // Last 30 days, past meetings 10, 11, 12 x 3 invitees = 9; attended: Ana 3 + Cene 2 = 5
  assert.deepEqual(a.tiles.attendance30, { rate: 56, attended: 5, total: 9 });
  assert.equal(a.tiles.finishedThisWeek, 1, "task 100 once; the unconfirmed AI task does not count");
});

test("hours: this week per member sorted, and per week by tier", () => {
  const a = computeAnalytics(data, { tier: null, series: null, range: "4w" });
  assert.deepEqual(a.hoursThisWeek.map((r) => [r.name, r.hours, r.onTrack]), [["Ana", 30, true], ["Bor", 0.5, false], ["Cene", 0, false]]);
  assert.deepEqual(a.weeks, ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  assert.deepEqual(a.hoursByTier[2], { week: "2026-10-19", Core: 70, Impact: 10, "GO!": 1 });
  const core = computeAnalytics(data, { tier: "Core", series: null, range: "8w" });
  assert.deepEqual(core.tiers, ["Core"]);
  assert.equal(core.weeks.length, 8);
  assert.deepEqual(core.hoursThisWeek.map((r) => r.name), ["Ana"]);
});

test("office vs home: per week and per tier; entries without a location stay unspecified", () => {
  const withLocation: Data = {
    ...data,
    hours: weeklyHours(entries.map((e, i) => ({ ...e, location: i === 0 ? ("office" as const) : i === 1 ? ("home" as const) : null })), now),
  };
  const a = computeAnalytics(withLocation, { tier: null, series: null, range: "4w" });
  assert.deepEqual(a.locationByWeek.at(-1), { week: "2026-10-26", office: 30, home: 0.5, unspecified: 0 });
  assert.deepEqual(a.locationByWeek.at(-2), { week: "2026-10-19", office: 0, home: 0, unspecified: 81 });
  assert.deepEqual(a.locationByTier, [
    { tier: "Core", office: 30, home: 0, unspecified: 210 },
    { tier: "Impact", office: 0, home: 0, unspecified: 30 },
    { tier: "GO!", office: 0, home: 0.5, unspecified: 3 },
  ]);
  const core = computeAnalytics(withLocation, { tier: "Core", series: null, range: "4w" });
  assert.deepEqual(core.locationByTier.map((r) => r.tier), ["Core"]);
});

test("attendance: rate per series, heatmap of past meetings with unanswered as unexcused", () => {
  const a = computeAnalytics(data, { tier: null, series: null, range: "8w" });
  assert.deepEqual(a.attendanceBySeries, [
    { series: "Community", rate: 67, attended: 2, total: 3 },
    { series: "Grants", rate: 50, attended: 3, total: 6 },
  ]);
  assert.deepEqual(a.heatmap.meetings.map((m) => m.id), [10, 11, 12], "future meetings are not in the heatmap");
  assert.deepEqual(a.heatmap.rows.find((r) => r.name === "Bor")?.cells, ["unexcused", "unexcused", "unexcused"]);
  const grants = computeAnalytics(data, { tier: null, series: "Grants", range: "8w" });
  assert.deepEqual(grants.heatmap.meetings.map((m) => m.id), [10, 11]);
  assert.deepEqual(grants.allSeries, ["Community", "Grants"], "the series filter still lists every series");
});

test("tasks: finished per member and created vs finished per week, AI as its own slice", () => {
  const a = computeAnalytics(data, { tier: null, series: null, range: "4w" });
  assert.deepEqual(a.finishedPerMember.map((r) => [r.name, r.n]), [["Ana", 1], ["Cene", 1]]);
  assert.ok(a.anyAi);
  assert.deepEqual(a.tasksPerWeek.at(-1), { week: "2026-10-26", created: 1, aiCreated: 1, finished: 1 });
  assert.deepEqual(a.tasksPerWeek.at(-2), { week: "2026-10-19", created: 1, aiCreated: 1, finished: 1 }, "deleted task 103 is not counted; reopened 104 is not finished");
  assert.ok(!a.finishedPerMember.some((r) => r.name === "Bor"), "a reopened task no longer counts for its assignee");
});

test("drifting: under 50% for 2+ weeks, or 2+ unexcused in the last 6 meetings", () => {
  const a = computeAnalytics(data, { tier: null, series: null, range: "4w" });
  assert.deepEqual(a.drifting.map((r) => r.name), ["Bor"]);
  assert.deepEqual(a.drifting[0].reasons, [
    "Under 50% of their 4 h target in 4 of the last 4 weeks (average 25%)",
    "3 unexcused absences in their last 3 meetings",
  ]);
});
