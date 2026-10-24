// Database test (runs on the *_test database that npm test sets up): Stop saves the entry, and the
// sheet write puts it in the "Ure dela" tab. Google is replaced by an in-memory fake.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { FakeSheets } from "@/lib/google/fake-sheets";
import { entriesBetween, hoursSheetQueue } from "./queries";
import { syncHoursSheet } from "./sheet-sync";
import { stopTimer } from "./timer";
import { weekBounds, weekStartOf } from "./time";
import { testDatabaseSkip } from "@/lib/test-db";

const TAB = "Ure dela";
let memberId: number;

async function startTimerAgo(seconds: number): Promise<number> {
  const [row] = await db
    .insert(timeEntries)
    .values({ memberId, startedAt: new Date(Date.now() - seconds * 1000), source: "timer" })
    .returning({ id: timeEntries.id });
  return row.id;
}

describe("Stop and the hours sheet", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    delete process.env.GOOGLE_SHEET_HOURS_TAB;
    const [m] = await db
      .insert(members)
      .values({ name: "Stop Test", email: `stop.test.${Date.now()}@sandbox.example`, tier: "GO!", weeklyHours: 4 })
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

  test("Stop after more than a minute saves the entry with an end time, listed straight away", async () => {
    const id = await startTimerAgo(125);
    const result = await stopTimer(memberId);
    assert.equal(result.kind, "saved");
    assert.ok(result.kind === "saved" && result.ms >= 125_000);

    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    assert.ok(entry.endedAt, "ended_at is set");
    assert.equal(entry.sheetStatus, "pending");
    const { from, to } = weekBounds(weekStartOf(new Date()));
    const listed = await entriesBetween(memberId, from, to);
    assert.deepEqual(listed.map((e) => e.id), [id], "the member's list shows it");
    assert.equal((await stopTimer(memberId)).kind, "none", "a second Stop does nothing");
  });

  test("Stop within a minute discards the run", async () => {
    await startTimerAgo(30);
    assert.equal((await stopTimer(memberId)).kind, "discarded");
    assert.equal((await db.select().from(timeEntries).where(eq(timeEntries.memberId, memberId))).length, 0);
  });

  test("the sheet write creates the tab with its header, adds the row once, and only touches that tab", async () => {
    const id = await startTimerAgo(600);
    await stopTimer(memberId);
    const sheets = new FakeSheets({ List1: [["task", "Geslo"], ["x", "secret"]] });

    const first = await syncHoursSheet({ api: sheets, sheetId: "test" });
    assert.ok(first.ok, first.error);
    const rows = sheets.rows(TAB);
    assert.deepEqual(rows[0], ["oseba", "dan začetka", "ura začetka", "dan konca", "ura konca", "id"]);
    const ours = rows.filter((r) => r[5] === id);
    assert.equal(ours.length, 1, "one row with the entry id in column F");
    assert.equal(ours[0][0], "Stop Test");
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    assert.equal(entry.sheetStatus, "synced");

    // Running it again (or a retry) never duplicates.
    await db.update(timeEntries).set({ sheetStatus: "pending", updatedAt: new Date() }).where(eq(timeEntries.id, id));
    await syncHoursSheet({ api: sheets, sheetId: "test" });
    assert.equal(sheets.rows(TAB).filter((r) => r[5] === id).length, 1);

    const touched = [...sheets.reads, ...sheets.writes];
    assert.ok(touched.every((r) => r.startsWith(`'${TAB}'!`)), `only the hours tab: ${touched.join(", ")}`);
  });

  test("a Google error is stored on the entry and shown as the last error", async () => {
    const id = await startTimerAgo(300);
    await stopTimer(memberId);
    const sheets = new FakeSheets();
    sheets.failWith = { status: 403, code: "PERMISSION_DENIED", message: "The caller does not have permission" };

    const result = await syncHoursSheet({ api: sheets, sheetId: "test" });
    assert.equal(result.ok, false);
    assert.equal(result.error, `Could not reach the "${TAB}" tab: 403 PERMISSION_DENIED: The caller does not have permission`);
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    assert.equal(entry.sheetStatus, "pending");
    assert.equal(entry.sheetError, result.error);
    assert.equal((await hoursSheetQueue()).lastError, result.error);
  });
});
