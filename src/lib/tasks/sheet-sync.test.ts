// Database test for the two-way tasks sync, with Google replaced by an in-memory fake.
// It empties the tasks table, so it only runs against a local database (localhost DATABASE_URL).
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { members, syncState, taskEvents, tasks, taskSyncs } from "@/db/schema";
import { FakeSheets } from "@/lib/google/fake-sheets";
import { runTasksSync, syncTasks, TASKS_SYNC } from "./sheet-sync";

const TAB = "List1";
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");
const sheets = new FakeSheets();
const sync = () => syncTasks({ actorId: null, api: sheets, sheetId: "test", today: "2026-10-24" });
const rows = () => sheets.rows(TAB);
const rowOf = (title: string) => rows().find((r) => r[0] === title)!;
const taskBy = async (title: string) => (await db.select().from(tasks).where(eq(tasks.title, title)))[0];
let ids: Record<string, number> = {};

describe("two-way tasks sync", { skip: !local && "needs a local DATABASE_URL (it empties the tasks table)" }, () => {
  before(async () => {
    delete process.env.GOOGLE_SHEET_TASKS_TAB;
    await db.delete(tasks);
    await db.delete(taskSyncs);
    await db.delete(syncState).where(eq(syncState.name, TASKS_SYNC));
    const people = await db
      .select({ id: members.id, email: members.email })
      .from(members)
      .where(inArray(members.email, ["ziga.krajnc@sandbox.example", "ana.kovac@sandbox.example", "eva.vidmar@sandbox.example"]));
    ids = Object.fromEntries(people.map((p) => [p.email.split(".")[0], p.id]));
    sheets.addTab(TAB, [
      ["task", "status", "nosilec", "tip taska", "deadline", "Geslo"],
      ["Objava na IG", "to do", "Žiga", "Marketing", "30.10.2026", "secret-1"],
      ["Plakat", "v teku", "ana.kovac@sandbox.example", "marketing", "15.11.", "secret-2"],
      ["Najem dvorane", "blocked", "Marko", "logistika", "", "secret-3"],
      [],
      ["", "done", "Eva", "", "", "secret-4"],
    ]);
    sheets.addTab("Users", [["email", "Geslo"], ["ana", "pw"]]);
  });
  after(async () => {
    await db.delete(tasks);
    await closeDb();
  });

  test("first sync imports rows, adds the id column after the last header and writes a key into each row", async () => {
    const report = await sync();
    assert.deepEqual(report.created.map((c) => c.title), ["Objava na IG", "Plakat", "Najem dvorane"]);
    assert.deepEqual(report.skipped, [{ row: 6, reason: "no task title" }]);
    assert.deepEqual(report.unassigned.map((u) => u.raw), ["Marko"]);
    assert.equal(rows()[0][6], "id");
    for (const title of ["Objava na IG", "Plakat", "Najem dvorane"]) {
      const t = await taskBy(title);
      assert.match(String(rowOf(title)[6]), /^t-[0-9a-f]{10}$/);
      assert.equal(rowOf(title)[6], t.sheetKey);
    }
    assert.equal((await taskBy("Plakat")).assigneeId, ids.ana);
    // Types: "Marketing" / "marketing" become the listed "Marketing"; a type not in the list is kept as typed.
    assert.equal((await taskBy("Objava na IG")).type, "Marketing");
    assert.equal((await taskBy("Plakat")).type, "Marketing");
    assert.equal((await taskBy("Najem dvorane")).type, "logistika");
  });

  test("never reads the Geslo column or any other tab, and leaves Geslo untouched", () => {
    const dataReads = sheets.reads.filter((r) => !r.endsWith("!1:1"));
    assert.ok(dataReads.every((r) => !/!F/.test(r)), dataReads.join(", "));
    assert.ok([...sheets.reads, ...sheets.writes].every((r) => r.startsWith(`'${TAB}'!`)));
    assert.ok(sheets.writes.every((r) => !/!F/.test(r)), "nothing written to column F");
    assert.deepEqual(rows().map((r) => r[5]).filter(Boolean), ["Geslo", "secret-1", "secret-2", "secret-3", "secret-4"]);
  });

  test("a second sync, and a sync after sorting the sheet, change nothing and create no duplicates", async () => {
    const writes = sheets.writes.length;
    let report = await sync();
    assert.equal(report.created.length + report.appended.length + report.updated.length + report.exported.length, 0);
    assert.equal(report.unchanged, 3);
    assert.equal(sheets.writes.length, writes, "nothing written");

    const grid = sheets.tabs.get(TAB)!.grid;
    grid.splice(1, grid.length - 1, ...grid.slice(1).reverse()); // sort descending
    report = await sync();
    assert.equal(report.created.length, 0);
    assert.equal(report.unchanged, 3);
    assert.equal((await db.select().from(tasks)).length, 3);
  });

  test("an app edit is written to the sheet; a sheet edit is imported with history", async () => {
    const objava = await taskBy("Objava na IG");
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, objava.id));
    const plakatRow = rows().findIndex((r) => r[0] === "Plakat");
    sheets.tabs.get(TAB)!.grid[plakatRow][4] = "20.11.2026";

    const report = await sync();
    assert.deepEqual(report.exported, [{ row: rows().findIndex((r) => r[0] === "Objava na IG") + 1, title: "Objava na IG", fields: ["status"] }]);
    assert.equal(rowOf("Objava na IG")[1], "done");
    assert.deepEqual(report.updated.map((u) => [u.title, u.fields]), [["Plakat", ["dueDate"]]]);
    const plakat = await taskBy("Plakat");
    assert.equal(plakat.dueDate, "2026-11-20");
    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, plakat.id));
    assert.ok(events.some((e) => e.source === "sheet_sync" && e.field === "dueDate" && e.newValue === "2026-11-20"));
    assert.equal((await sync()).unchanged, 3, "stable afterwards");
  });

  test("conflict: both sides changed the same field, the app wins and the sheet value is kept in history", async () => {
    const najem = await taskBy("Najem dvorane");
    await db.update(tasks).set({ type: "events", assigneeId: ids.ziga }).where(eq(tasks.id, najem.id));
    const r = rows().findIndex((x) => x[0] === "Najem dvorane");
    sheets.tabs.get(TAB)!.grid[r][3] = "prostori"; // type changed in the sheet too
    sheets.tabs.get(TAB)!.grid[r][1] = "done"; // status changed only in the sheet

    const report = await sync();
    assert.deepEqual(report.conflicts.map((c) => [c.field, c.sheetValue, c.appValue]), [["type", "prostori", "events"]]);
    assert.equal(rowOf("Najem dvorane")[3], "events");
    assert.equal(rowOf("Najem dvorane")[2], "Žiga", "assignee written in the sheet's style (first names)");
    const t = await taskBy("Najem dvorane");
    assert.equal(t.status, "done");
    assert.equal(t.type, "events");
    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, t.id));
    assert.ok(events.some((e) => e.kind === "conflict" && e.oldValue === "prostori" && e.newValue === "events"));
    assert.equal(report.unassigned.length, 0, "no longer unassigned");
  });

  test("verifikacija syncs both ways and is not an unknown status", async () => {
    const objava = await taskBy("Objava na IG");
    await db.update(tasks).set({ status: "verification" }).where(eq(tasks.id, objava.id));
    let report = await sync();
    assert.equal(rowOf("Objava na IG")[1], "verifikacija", "app -> sheet");

    const r = rows().findIndex((x) => x[0] === "Plakat");
    sheets.tabs.get(TAB)!.grid[r][1] = "Verifikacija";
    report = await sync();
    assert.equal((await taskBy("Plakat")).status, "verification", "sheet -> app");
    assert.ok(!report.warnings.some((w) => w.message.includes("unknown status")), JSON.stringify(report.warnings));
    assert.equal((await sync()).unchanged, 3, "stable afterwards");
  });

  test("a task created in the app is appended once with its key", async () => {
    const [created] = await db
      .insert(tasks)
      .values({ title: "=Nova naloga", status: "todo", assigneeId: ids.eva, type: "grants", dueDate: "2026-12-01", source: "app", createdById: ids.eva })
      .returning();
    let report = await sync();
    assert.deepEqual(report.appended.map((a) => a.title), ["=Nova naloga"]);
    const row = rowOf("=Nova naloga");
    assert.deepEqual(row.slice(0, 5), ["=Nova naloga", "to do", "Eva", "grants", "01.12.2026"]);
    assert.equal(row[6], (await taskBy("=Nova naloga")).sheetKey);
    report = await sync();
    assert.equal(report.appended.length + report.created.length, 0);
    assert.equal(rows().filter((r) => r[0] === "=Nova naloga").length, 1);
    assert.ok(created.id);
  });

  test("a deleted row flags the task without re-adding it; a copied row becomes a new task", async () => {
    const grid = sheets.tabs.get(TAB)!.grid;
    const plakat = grid.findIndex((r) => r[0] === "Plakat");
    const copy = [...grid.find((r) => r[0] === "Objava na IG")!];
    grid.splice(plakat, 1);
    grid.push(copy);

    const report = await sync();
    assert.deepEqual(report.noLongerInSheet, [{ title: "Plakat" }]);
    assert.equal((await taskBy("Plakat")).inSheet, false);
    assert.equal(report.created.length, 1, "the copy is a new task");
    const keys = rows().slice(1).map((r) => r[6]).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, "the copy got its own key");
    assert.equal((await sync()).appended.length, 0, "Plakat is not re-added");
  });

  test("a task deleted in the app loses its sheet row and is not imported again", async () => {
    const najem = await taskBy("Najem dvorane");
    const rowsBefore = rows().length;
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, najem.id));
    const report = await sync();
    assert.deepEqual(report.removedFromSheet, [{ title: "Najem dvorane" }]);
    assert.equal(rows().length, rowsBefore - 1);
    assert.ok(!rows().some((r) => r[0] === "Najem dvorane"));
    assert.ok(rows().some((r) => r[0] === "=Nova naloga"), "other rows intact");
    const again = await sync();
    assert.equal(again.created.length + again.appended.length + again.removedFromSheet.length, 0, "stable, not re-imported");
  });

  test("runTasksSync: one at a time, and background syncs wait 60 s unless forced", async () => {
    const first = await runTasksSync({ api: sheets, sheetId: "test", force: true });
    assert.ok(first.ran && first.report?.ok);
    assert.equal((await runTasksSync({ api: sheets, sheetId: "test" })).ran, false, "within 60 s");
    await db.update(syncState).set({ runningSince: new Date() }).where(eq(syncState.name, TASKS_SYNC));
    assert.equal((await runTasksSync({ api: sheets, sheetId: "test", force: true })).ran, false, "another sync is running");
    await db.update(syncState).set({ runningSince: null }).where(eq(syncState.name, TASKS_SYNC));

    sheets.failWith = { status: 403, code: "PERMISSION_DENIED", message: "The caller does not have permission" };
    const failed = await runTasksSync({ api: sheets, sheetId: "test", force: true });
    assert.equal(failed.report?.error, "403 PERMISSION_DENIED: The caller does not have permission");
    sheets.failWith = null;
  });
});
