// Database test: the one-query version of "selected week + history" (memberWeekAndHistory) gives exactly what
// the two separate queries (memberWeek + weeklyTotals) gave, with and without a running timer.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { memberWeek, memberWeekAndHistory, weeklyTotals } from "./queries";
import { addDays, weekStartOf } from "./time";

const now = new Date("2026-10-28T11:00:00Z");
const at = (iso: string) => new Date(iso);
let memberId: number;

describe("member week and history in one query", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    const [m] = await db.insert(members).values({ name: "History Test", email: `history.${Date.now()}@sandbox.example`, tier: "Impact", weeklyHours: 10 }).returning({ id: members.id });
    memberId = m.id;
  });
  beforeEach(async () => {
    await db.delete(timeEntries).where(eq(timeEntries.memberId, memberId));
    await db.insert(timeEntries).values([
      { memberId, startedAt: at("2026-10-26T08:00:00Z"), endedAt: at("2026-10-26T10:00:00Z"), source: "manual", location: "office" },
      { memberId, startedAt: at("2026-10-18T21:30:00Z"), endedAt: at("2026-10-18T23:45:00Z"), source: "manual", location: "home" }, // crosses into the week of the 19th
      { memberId, startedAt: at("2026-10-14T08:00:00Z"), endedAt: at("2026-10-14T09:00:00Z"), source: "seed", location: null },
      { memberId, startedAt: at("2026-08-03T08:00:00Z"), endedAt: at("2026-08-03T12:00:00Z"), source: "seed", location: null }, // older than 8 weeks
      { memberId, startedAt: at("2026-10-14T10:00:00Z"), endedAt: at("2026-10-14T11:00:00Z"), source: "manual", location: "office", deletedAt: now },
    ]);
  });
  after(async () => {
    await db.delete(members).where(eq(members.id, memberId));
    await closeDb();
  });

  async function check(week: string, running: boolean) {
    const thisWeek = weekStartOf(now);
    if (running) await db.insert(timeEntries).values({ memberId, startedAt: at("2026-10-28T09:00:00Z"), source: "timer", location: "home" });
    const one = await memberWeekAndHistory(memberId, week, thisWeek, 8, now);
    const [data, history] = await Promise.all([memberWeek(memberId, week, now), weeklyTotals(memberId, thisWeek, 8, now)]);
    assert.deepEqual(one.data, data, `week ${week}${running ? " with a timer" : ""}`);
    assert.deepEqual(one.history, history, "history");
    if (running) await db.delete(timeEntries).where(and(eq(timeEntries.memberId, memberId), isNull(timeEntries.endedAt))); // one running timer per member
    return one;
  }

  test("current week, with and without a running timer", async () => {
    const without = await check(weekStartOf(now), false);
    assert.equal(without.data.running, null);
    const withTimer = await check(weekStartOf(now), true);
    assert.ok(withTimer.data.running, "the timer is found");
    assert.equal(withTimer.data.byLocation.home, 2 * 3_600_000, "9:00 to now (11:00)");
  });

  test("an earlier week (also with the timer running now), and one older than the 8 weeks of history", async () => {
    await check(addDays(weekStartOf(now), -7), true);
    await check("2026-08-03", false);
    const old = await check("2026-08-03", true);
    assert.equal(old.data.entries.length, 1);
    assert.ok(old.data.running, "a running timer is found whatever week is shown");
  });
});
