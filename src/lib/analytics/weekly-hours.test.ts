// Database test (runs on the *_test database that npm test sets up): the hours the analytics page adds up in
// SQL equal the plain JavaScript way (overlapMs), including the awkward cases: an entry that crosses
// Sunday midnight, the autumn clock change (25 Oct 2026, a 169-hour week), a running timer and a deleted entry.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { addDays, weekStartOf } from "@/lib/hours/time";
import { loadWeeklyHours } from "./weekly-hours";
import { weeklyHours, type Entry } from "./test-helpers";

const now = new Date("2026-10-28T11:00:00Z");
const at = (iso: string) => new Date(iso);
let memberIds: number[] = [];

const entries = (ids: number[]): (Entry & { deleted?: boolean })[] => [
  { memberId: ids[0], startedAt: at("2026-10-26T08:00:00Z"), endedAt: at("2026-10-26T10:30:00Z"), location: "office" },
  // Sunday night into Monday (Ljubljana time): split between two weeks
  { memberId: ids[0], startedAt: at("2026-10-18T21:30:00Z"), endedAt: at("2026-10-18T23:45:00Z"), location: "home" }, // Sun 23:30 - Mon 01:45 (CEST)
  // The clock goes back on Sun 25 Oct at 03:00 -> 02:00: the week of the 19th has 169 hours
  { memberId: ids[1], startedAt: at("2026-10-24T22:30:00Z"), endedAt: at("2026-10-25T03:30:00Z"), location: null }, // Sun 00:30 CEST - 04:30 CET
  { memberId: ids[1], startedAt: at("2026-10-25T22:00:00Z"), endedAt: at("2026-10-26T01:00:00Z"), location: "home" }, // Sun 23:00 CET - Mon 02:00 CET
  // A running timer counts up to now
  { memberId: ids[1], startedAt: at("2026-10-28T08:00:00Z"), endedAt: null, location: "office" },
  // Older weeks, two entries in the same week and location
  { memberId: ids[0], startedAt: at("2026-09-30T08:00:00Z"), endedAt: at("2026-09-30T09:00:00Z"), location: "office" },
  { memberId: ids[0], startedAt: at("2026-10-01T08:00:00Z"), endedAt: at("2026-10-01T09:30:00Z"), location: "office" },
  // Not counted: deleted
  { memberId: ids[0], startedAt: at("2026-10-27T08:00:00Z"), endedAt: at("2026-10-27T18:00:00Z"), location: "office", deleted: true },
];

describe("weekly hours in SQL", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    const rows = await db
      .insert(members)
      .values([1, 2].map((i) => ({ name: `Weekly ${i}`, email: `weekly.${i}.${Date.now()}@sandbox.example`, tier: "Impact" as const, weeklyHours: 10 })))
      .returning({ id: members.id });
    memberIds = rows.map((r) => r.id);
    await db.insert(timeEntries).values(
      entries(memberIds).map((e) => ({ memberId: e.memberId, startedAt: e.startedAt, endedAt: e.endedAt, location: e.location ?? null, source: "manual" as const, deletedAt: e.deleted ? now : null })),
    );
  });
  after(async () => {
    for (const id of memberIds) await db.delete(members).where(eq(members.id, id));
    await closeDb();
  });

  test("matches the JavaScript way for every member, week and location", async () => {
    const thisWeek = weekStartOf(now);
    const weeks = Array.from({ length: 26 }, (_, i) => addDays(thisWeek, -7 * (25 - i)));
    const sql = (await loadWeeklyHours(weeks, now)).filter((r) => memberIds.includes(r.memberId));
    const expected = weeklyHours(entries(memberIds).filter((e) => !e.deleted), now).filter((r) => memberIds.includes(r.memberId));
    const key = (r: { memberId: number; week: string; location: string | null }) => `${r.memberId}|${r.week}|${r.location ?? ""}`;
    const sorted = (rows: typeof sql) => rows.map((r) => [key(r), r.ms] as const).sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepEqual(sorted(sql), sorted(expected));
    assert.ok(sql.length >= 7, "the awkward cases are really in there");
  });

  test("spot checks of the awkward cases", async () => {
    const thisWeek = weekStartOf(now);
    const rows = await loadWeeklyHours([addDays(thisWeek, -14), addDays(thisWeek, -7), thisWeek], now);
    const ms = (member: number, week: string, location: string | null) => rows.find((r) => r.memberId === memberIds[member] && r.week === week && r.location === location)?.ms;
    const H = 3_600_000;
    assert.equal(ms(0, "2026-10-12", "home"), 30 * 60_000 + 0, "Sunday 23:30 to midnight in the old week: 30 min");
    assert.equal(ms(0, "2026-10-19", "home"), 105 * 60_000, "...and 1 h 45 min of it after midnight in the next week");
    assert.equal(ms(1, "2026-10-19", null), 5 * H, "00:30 CEST to 04:30 CET is five real hours");
    assert.equal(ms(1, "2026-10-26", "home"), 2 * H, "Mon 00:00 to 02:00 of the entry that started on Sunday evening");
    assert.equal(ms(1, "2026-10-19", "home"), 1 * H, "...and its Sunday part, 23:00 to midnight");
    assert.equal(ms(1, "2026-10-26", "office"), 3 * H, "a running timer counts up to now");
    assert.equal(ms(0, "2026-10-26", "office"), 2.5 * H, "the deleted entry is not counted");
  });

  test("an empty list of weeks and weeks without entries give no rows", async () => {
    const rows = await loadWeeklyHours(["2026-01-05"], now);
    assert.deepEqual(rows.filter((r) => memberIds.includes(r.memberId)), []);
  });
});
