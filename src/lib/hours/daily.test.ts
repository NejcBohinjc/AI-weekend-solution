import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyHours } from "./daily";
import { overlapMs, weekBounds } from "./time";

const at = (iso: string) => new Date(iso);
const H = 3_600_000;

test("hours per day: clipped to Ljubljana days, location split, today and future marked", () => {
  const now = at("2026-10-22T10:00:00Z"); // Thursday
  const days = dailyHours(
    [
      { startedAt: at("2026-10-19T07:00:00Z"), endedAt: at("2026-10-19T09:30:00Z"), location: "office" }, // Mon 2.5 h
      { startedAt: at("2026-10-20T21:30:00Z"), endedAt: at("2026-10-20T23:30:00Z"), location: "home" }, // Tue 23:30 -> Wed 01:30 (CEST): 30 min + 90 min
      { startedAt: at("2026-10-22T08:00:00Z"), endedAt: null, location: null }, // running since 10:00 local, now 12:00 local: 2 h
    ],
    "2026-10-19",
    now,
  );
  assert.deepEqual(days.map((d) => d.weekday), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(days.map((d) => d.hours), [2.5, 0.5, 1.5, 2, 0, 0, 0]);
  assert.deepEqual([days[0].office, days[1].home, days[2].home, days[3].unspecified], [2.5, 0.5, 1.5, 2]);
  assert.deepEqual(days.map((d) => [d.today, d.future]), [[false, false], [false, false], [false, false], [true, false], [false, true], [false, true], [false, true]]);
  assert.equal(days[0].label, "Mon 19 Oct");
});

test("the seven days add up to the week, also in the week the clocks change (25 Oct 2026, 169 hours)", () => {
  const now = at("2026-10-28T11:00:00Z");
  const entries = [
    { startedAt: at("2026-10-24T22:30:00Z"), endedAt: at("2026-10-25T03:30:00Z"), location: "office" as const }, // Sun 00:30 CEST - 04:30 CET: 5 real hours
    { startedAt: at("2026-10-25T22:00:00Z"), endedAt: at("2026-10-26T01:00:00Z"), location: "home" as const }, // Sun 23:00 CET -> Mon 02:00
    { startedAt: at("2026-10-19T21:00:00Z"), endedAt: at("2026-10-20T05:00:00Z"), location: null }, // across a night
  ];
  for (const week of ["2026-10-19", "2026-10-26"]) {
    const { from, to } = weekBounds(week);
    const expected = entries.reduce((s, e) => s + overlapMs(e.startedAt, e.endedAt, from, to, now), 0) / H;
    const sum = dailyHours(entries, week, now).reduce((s, d) => s + d.hours, 0);
    assert.ok(Math.abs(sum - expected) < 1e-9, `${week}: ${sum} vs ${expected}`);
  }
  assert.equal(dailyHours(entries, "2026-10-19", now)[6].hours, 5 + 1, "Sunday: the 5 hours from midnight and the 1 hour to midnight");
});
