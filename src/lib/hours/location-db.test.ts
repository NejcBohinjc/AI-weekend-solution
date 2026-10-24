// Database test (runs on the *_test database that npm test sets up): the default location is the
// member's last choice, and the week splits hours by office / home / unspecified.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { lastLocation, memberWeek } from "./queries";
import { weekBounds, weekStartOf } from "./time";
import { stopTimer } from "./timer";

let memberId: number;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

describe("work location", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    const [m] = await db
      .insert(members)
      .values({ name: "Location Test", email: `location.test.${Date.now()}@sandbox.example`, tier: "Impact", weeklyHours: 10 })
      .returning({ id: members.id });
    memberId = m.id;
  });
  beforeEach(async () => {
    await db.delete(timeEntries).where(eq(timeEntries.memberId, memberId));
  });
  after(async () => {
    await db.delete(members).where(eq(members.id, memberId));
    await closeDb();
  });

  test("default is office with no history, then the last choice; seeded entries without one are skipped", async () => {
    assert.equal(await lastLocation(memberId), "office");
    await db.insert(timeEntries).values([
      { memberId, startedAt: hoursAgo(30), endedAt: hoursAgo(29), source: "manual", location: "home" },
      { memberId, startedAt: hoursAgo(5), endedAt: hoursAgo(4), source: "seed", location: null },
    ]);
    assert.equal(await lastLocation(memberId), "home", "the newer seeded entry has no location and is not a choice");
    await db.insert(timeEntries).values({ memberId, startedAt: hoursAgo(3), endedAt: hoursAgo(2), source: "timer", location: "office" });
    assert.equal(await lastLocation(memberId), "office");
  });

  test("Stop keeps the location the timer was started with", async () => {
    const [{ id }] = await db.insert(timeEntries).values({ memberId, startedAt: hoursAgo(1), source: "timer", location: "home" }).returning({ id: timeEntries.id });
    assert.equal((await stopTimer(memberId)).kind, "saved");
    const [row] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    assert.equal(row.location, "home");
  });

  test("the week is split by location, unspecified for entries without one", async () => {
    const now = new Date();
    const start = new Date(Math.max(hoursAgo(3).getTime(), weekBounds(weekStartOf(now)).from.getTime() + 3_600_000));
    // Keep all three entries inside this week, whatever day the test runs.
    const slot = (i: number) => ({ startedAt: new Date(start.getTime() + i * 1_200_000), endedAt: new Date(start.getTime() + (i + 1) * 1_200_000 - 60_000) });
    await db.insert(timeEntries).values([
      { memberId, ...slot(0), source: "manual", location: "office" },
      { memberId, ...slot(1), source: "manual", location: "home" },
      { memberId, ...slot(2), source: "seed", location: null },
    ]);
    const week = await memberWeek(memberId, weekStartOf(now), new Date(start.getTime() + 4 * 1_200_000));
    const each = 19 * 60_000;
    assert.deepEqual(week.byLocation, { office: each, home: each, unspecified: each });
    assert.equal(week.totalMs, 3 * each);
  });
});
