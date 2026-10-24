import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditEntry,
  formatDuration,
  formatHours,
  formatWeek,
  fromFirstWeekWithHours,
  fromLocalInput,
  hoursReturnPath,
  isWeekStart,
  ljubljanaParts,
  ljubljanaToUtc,
  overlapMs,
  parseEntryTimes,
  sheetRow,
  toLocalInput,
  weekBounds,
  weekPace,
  weekStartOf,
} from "./time";

const H = 3_600_000;

test("converts Ljubljana wall-clock times to instants, summer and winter", () => {
  assert.equal(ljubljanaToUtc("2026-10-24", "09:12").toISOString(), "2026-10-24T07:12:00.000Z");
  assert.equal(ljubljanaToUtc("2026-10-26", "09:12").toISOString(), "2026-10-26T08:12:00.000Z");
  // 02:30 does not exist on 29 March 2026 (clocks jump to 03:00): it moves forward to 03:30.
  assert.equal(ljubljanaToUtc("2026-03-29", "02:30").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.deepEqual(ljubljanaParts(new Date("2026-10-24T22:30:00Z")), { date: "2026-10-25", time: "00:30", seconds: 0, weekday: 7 });
});

test("weeks start on Monday in Ljubljana", () => {
  assert.equal(weekStartOf(new Date("2026-10-24T10:00:00Z")), "2026-10-19");
  // Sunday 23:30 in Ljubljana is still the old week; Monday 00:30 is the new one.
  assert.equal(weekStartOf(new Date("2026-10-25T22:30:00Z")), "2026-10-19");
  assert.equal(weekStartOf(new Date("2026-10-25T23:30:00Z")), "2026-10-26");
  const { from, to } = weekBounds("2026-10-19");
  assert.equal(from.toISOString(), "2026-10-18T22:00:00.000Z");
  assert.equal(to.toISOString(), "2026-10-25T23:00:00.000Z"); // the week of the clock change has 169 hours
  assert.equal(isWeekStart("2026-10-19"), true);
  assert.equal(isWeekStart("2026-10-20"), false);
  assert.equal(isWeekStart("2026-02-30"), false);
  assert.equal(formatWeek("2026-10-19"), "19–25 Oct");
  assert.match(formatWeek("2026-09-28"), /^28 Sept? – 4 Oct$/); // ICU versions differ on "Sep"/"Sept"
});

test("counts only the part of an entry inside the week, and running entries up to now", () => {
  const { from, to } = weekBounds("2026-10-19");
  const now = new Date("2026-10-24T10:00:00Z");
  assert.equal(overlapMs(new Date("2026-10-20T07:00:00Z"), new Date("2026-10-20T11:30:00Z"), from, to, now), 4.5 * H);
  // Sunday 22:00 to Monday 02:00 (Ljubljana): only the 2 hours on Monday count.
  assert.equal(overlapMs(new Date("2026-10-18T20:00:00Z"), new Date("2026-10-19T00:00:00Z"), from, to, now), 2 * H);
  assert.equal(overlapMs(new Date("2026-10-24T08:00:00Z"), null, from, to, now), 2 * H);
  assert.equal(overlapMs(new Date("2026-10-10T08:00:00Z"), new Date("2026-10-10T09:00:00Z"), from, to, now), 0);
});

test("formats durations and hours", () => {
  assert.equal(formatDuration(4.5 * H), "4 h 30 min");
  assert.equal(formatDuration(8 * H), "8 h");
  assert.equal(formatDuration(45 * 60_000 + 29_000), "45 min");
  assert.equal(formatDuration(8 * H - 1_000), "8 h"); // 7:59:59 reads as 8 h
  assert.equal(formatHours(12.47 * H), "12.4");
  assert.equal(formatHours(70 * H), "70");
});

test("parses manual entries, including overnight ones", () => {
  assert.deepEqual(parseEntryTimes("2026-10-20", "09:00", "13:30"), {
    startedAt: new Date("2026-10-20T07:00:00Z"),
    endedAt: new Date("2026-10-20T11:30:00Z"),
  });
  assert.deepEqual(parseEntryTimes("2026-10-20", "22:00", "02:00"), {
    startedAt: new Date("2026-10-20T20:00:00Z"),
    endedAt: new Date("2026-10-21T00:00:00Z"),
  });
  assert.deepEqual(parseEntryTimes("2026-02-30", "09:00", "10:00"), { error: "Pick a date." });
  assert.deepEqual(parseEntryTimes("2026-10-20", "9:00", "10:00"), { error: "Enter start and end times like 09:30." });
  assert.equal("error" in parseEntryTimes("2026-10-20", "09:00", "09:00"), false); // a full 24 hours is allowed
});

test("round-trips datetime-local values in Ljubljana time", () => {
  const at = new Date("2026-10-24T15:30:00Z");
  assert.equal(toLocalInput(at), "2026-10-24T17:30");
  assert.equal(fromLocalInput("2026-10-24T17:30")?.toISOString(), at.toISOString());
  assert.equal(fromLocalInput("nonsense"), null);
});

test("builds Ure dela rows in Ljubljana time and keeps names from turning into formulas", () => {
  assert.deepEqual(sheetRow("Ana Kovač", new Date("2026-10-24T07:12:00Z"), new Date("2026-10-24T22:05:00Z"), 7), [
    "Ana Kovač",
    "2026-10-24",
    "09:12",
    "2026-10-25",
    "00:05",
    7,
  ]);
  assert.equal(sheetRow("=HYPERLINK(1)", new Date(0), new Date(60_000), 1)[0], "'=HYPERLINK(1)");
});

test("members edit their own finished entries from this week; admins edit any finished entry", () => {
  const week = new Date("2026-10-18T22:00:00Z");
  const member = { id: 1, isAdmin: false };
  const admin = { id: 9, isAdmin: true };
  const entry = { memberId: 1, startedAt: new Date("2026-10-20T07:00:00Z"), endedAt: new Date("2026-10-20T09:00:00Z"), source: "timer" as const };
  assert.equal(canEditEntry(member, entry, week), true);
  assert.equal(canEditEntry({ id: 2, isAdmin: false }, entry, week), false);
  assert.equal(canEditEntry(member, { ...entry, startedAt: new Date("2026-10-15T07:00:00Z") }, week), false);
  assert.equal(canEditEntry(member, { ...entry, source: "seed" }, week), false);
  assert.equal(canEditEntry(member, { ...entry, endedAt: null }, week), false);
  assert.equal(canEditEntry(admin, { ...entry, startedAt: new Date("2026-09-15T07:00:00Z"), source: "seed" }, week), true);
});

test("recent weeks start at the first week with hours", () => {
  const w = (week: string, h: number) => ({ week, totalMs: h * H });
  // Newest first: this week is empty so far, data started two weeks ago, nothing before.
  assert.deepEqual(
    fromFirstWeekWithHours([w("2026-10-19", 0), w("2026-10-12", 5), w("2026-10-05", 0), w("2026-09-28", 3), w("2026-09-21", 0), w("2026-09-14", 0)]).map((x) => x.week),
    ["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28"], // an empty week between weeks with hours stays
  );
  assert.deepEqual(fromFirstWeekWithHours([w("2026-10-19", 0), w("2026-10-12", 0)]).map((x) => x.week), ["2026-10-19"]);
  assert.deepEqual(fromFirstWeekWithHours([]), []);
});

test("only returns to our own hours pages", () => {
  assert.equal(hoursReturnPath("/hours?week=2026-10-12"), "/hours?week=2026-10-12");
  assert.equal(hoursReturnPath("/admin/hours/3"), "/admin/hours/3");
  assert.equal(hoursReturnPath("https://evil.example/hours"), "/hours");
  assert.equal(hoursReturnPath("//evil.example"), "/hours");
  assert.equal(hoursReturnPath("/hoursx"), "/hours");
  assert.equal(hoursReturnPath(null), "/hours");
});

test("weekly pace is pro-rated during the week", () => {
  assert.equal(weekPace(70 * H, 70, 0.5), "met");
  assert.equal(weekPace(30 * H, 70, 0.5), "on_track"); // expected 35 h, 75% of that is 26.25 h
  assert.equal(weekPace(20 * H, 70, 0.5), "behind");
  assert.equal(weekPace(60 * H, 70, 1), "below");
  assert.equal(weekPace(0, 4, 0), "on_track");
});
