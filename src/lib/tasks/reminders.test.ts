// Database test for the task deadline reminder job. Email is not configured in tests, so emails are only
// recorded in email_log. Runs only on the *_test database that npm test sets up.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, gt, inArray, max } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { departments, emailLog, memberDepartments, members, reminderSettings, tasks } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { sendDueTaskReminders } from "./reminders";

const PEOPLE = {
  ana: { name: "Ana Opomnik", email: "reminder-ana@sandbox.example", active: true },
  bor: { name: "Bor Opomnik", email: "reminder-bor@sandbox.example", active: true },
  off: { name: "Ola Opomnik", email: "reminder-off@sandbox.example", active: true },
  gone: { name: "Gal Opomnik", email: "reminder-gone@sandbox.example", active: false },
};
const TITLES = ["R: Report", "R: Stand", "R: Done", "R: AI draft", "R: Later", "R: Removed from sheet"];
// Due Tuesday 27 Oct 2026; "1 day before" (the default) goes out on Monday at 08:00 Ljubljana = 07:00 UTC.
const DUE = "2026-10-27";
let ids: Record<keyof typeof PEOPLE, number>;
let lastEmailId = 0;

/** Emails to our test members since the last call. */
async function newEmails() {
  const rows = await db
    .select({ id: emailLog.id, to: emailLog.to, subject: emailLog.subject, body: emailLog.body })
    .from(emailLog)
    .where(and(gt(emailLog.id, lastEmailId), inArray(emailLog.memberId, Object.values(ids))));
  lastEmailId = Math.max(lastEmailId, ...rows.map((r) => r.id));
  return rows;
}

async function cleanUp() {
  await db.delete(tasks).where(inArray(tasks.title, TITLES));
  await db.delete(members).where(inArray(members.email, Object.values(PEOPLE).map((p) => p.email)));
}

describe("task deadline reminders", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    process.env.APP_URL ||= "http://localhost:3000";
    await cleanUp();
    const rows = await db
      .insert(members)
      .values(Object.values(PEOPLE).map((p) => ({ ...p, tier: "Impact" as const, weeklyHours: 10 })))
      .returning({ id: members.id, email: members.email });
    ids = Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, rows.find((r) => r.email === p.email)!.id])) as typeof ids;
    // Tech comes with the migration that added departments.
    const [tech] = await db.select().from(departments).where(eq(departments.name, "Tech"));
    await db.insert(memberDepartments).values([ids.bor, ids.off, ids.gone].map((memberId) => ({ memberId, departmentId: tech.id })));
    await db.insert(reminderSettings).values({ memberId: ids.off, taskEmailEnabled: false });
    await db.insert(tasks).values([
      { title: "R: Report", assigneeId: ids.ana, dueDate: DUE, priority: "urgent", status: "in_progress" },
      { title: "R: Stand", departmentId: tech.id, dueDate: DUE },
      { title: "R: Done", assigneeId: ids.ana, dueDate: DUE, status: "done" },
      { title: "R: AI draft", assigneeId: ids.ana, dueDate: DUE, createdByAi: true },
      { title: "R: Later", assigneeId: ids.ana, dueDate: "2026-11-20" },
      { title: "R: Removed from sheet", assigneeId: ids.ana, dueDate: DUE, inSheet: false },
    ]);
    const [{ last }] = await db.select({ last: max(emailLog.id) }).from(emailLog);
    lastEmailId = last ?? 0;
  });
  after(async () => {
    await cleanUp();
    await closeDb();
  });

  test("nothing before 08:00 the day before", async () => {
    const run = await sendDueTaskReminders(new Date("2026-10-26T06:55:00Z"));
    assert.ok(run.ran);
    assert.deepEqual(await newEmails(), []);
  });

  test("the assignee and the department's active members who want them get one email each, never twice", async () => {
    await sendDueTaskReminders(new Date("2026-10-26T07:05:00Z"));
    const emails = await newEmails();
    assert.deepEqual(emails.map((e) => [e.to, e.subject]).sort(), [
      [PEOPLE.ana.email, "Urgent, due tomorrow: R: Report"],
      [PEOPLE.bor.email, "Due tomorrow: R: Stand"],
    ]);
    assert.match(emails.find((e) => e.to === PEOPLE.bor.email)!.body, /delegated to the Tech department/);

    await sendDueTaskReminders(new Date("2026-10-26T07:10:00Z"));
    assert.deepEqual(await newEmails(), [], "nothing twice");
  });

  test("a rescheduled task is reminded again for its new due date; a past due date never", async () => {
    await db.update(tasks).set({ dueDate: "2026-10-28" }).where(eq(tasks.title, "R: Report"));
    await sendDueTaskReminders(new Date("2026-10-27T07:05:00Z"));
    assert.deepEqual((await newEmails()).map((e) => e.subject), ["Urgent, due tomorrow: R: Report"]);

    await sendDueTaskReminders(new Date("2026-10-29T07:05:00Z"));
    assert.deepEqual(await newEmails(), []);
  });

  test("turning reminders off stops them", async () => {
    await db.update(tasks).set({ dueDate: "2026-11-02" }).where(eq(tasks.title, "R: Report"));
    await db.insert(reminderSettings).values({ memberId: ids.ana, taskEmailEnabled: false });
    await sendDueTaskReminders(new Date("2026-11-01T07:05:00Z"));
    assert.deepEqual(await newEmails(), []);
  });
});
