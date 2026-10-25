// Database test (runs on the *_test database): the meeting and task reminder jobs claim what is due in a
// short transaction, send AFTER it, and mark each row. The sender is injected, so slow, failing and
// crashing mail servers can be played without a network.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { meetingInvites, meetingReminders, meetings, members, taskReminders, tasks } from "@/db/schema";
import type { OutgoingEmail } from "@/lib/email";
import { sendDueReminders } from "@/lib/meetings/reminders";
import type { SendResult } from "@/lib/reminder-delivery";
import { sendDueTaskReminders } from "@/lib/tasks/reminders";
import { testDatabaseSkip } from "@/lib/test-db";

// A far-away date so no other test's meetings or tasks are due. Default reminders: 1 day and 10 minutes before.
const NOW = new Date("2031-03-10T10:00:00Z");
const STARTS = new Date(NOW.getTime() + 24 * 3_600_000 - 5 * 60_000); // the 1-day reminder is due, the 10-minute one is not
const stamp = Date.now();
const emails = [1, 2, 3, 4].map((i) => `deliv.${i}.${stamp}@sandbox.example`);
let ids: number[] = [];
let meetingId: number;
const taskTitles = [1, 2, 3].map((i) => `Delivery task ${i} ${stamp}`);

/** A sender that records who it was asked to email, how many databases transactions were open meanwhile, and what the rows said. */
function sender(behave: (mail: OutgoingEmail) => Promise<SendResult> | SendResult = () => ({ id: null, status: "sent" })) {
  const calls: { to: string; openTransactions: number; pendingRows: number }[] = [];
  const send = async (mail: OutgoingEmail): Promise<SendResult> => {
    const [open] = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`);
    const [pending] = await db.execute<{ n: number }>(sql`select count(*)::int as n from meeting_reminders where status = 'pending' and meeting_id = ${meetingId}`);
    calls.push({ to: mail.to, openTransactions: open.n, pendingRows: pending.n });
    return behave(mail);
  };
  return { send, calls, tos: () => calls.map((c) => c.to).sort() };
}
const rows = () => db.select().from(meetingReminders).where(eq(meetingReminders.meetingId, meetingId));
const reset = () => db.delete(meetingReminders).where(eq(meetingReminders.meetingId, meetingId));

describe("reminder delivery", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    process.env.APP_URL ||= "http://localhost:3000";
    ids = (await db.insert(members).values(emails.map((email, i) => ({ name: `Deliv ${i + 1}`, email, tier: "GO!" as const, weeklyHours: 4 }))).returning({ id: members.id })).map((r) => r.id);
    [{ id: meetingId }] = await db
      .insert(meetings)
      .values({ uid: `delivery-${stamp}@sandbox.example`, title: "Delivery test", series: "Delivery", startsAt: STARTS, endsAt: new Date(STARTS.getTime() + 3_600_000) })
      .returning({ id: meetings.id });
    await db.insert(meetingInvites).values(ids.slice(0, 3).map((memberId) => ({ meetingId, memberId })));
  });
  after(async () => {
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    await db.delete(tasks).where(inArray(tasks.title, taskTitles));
    await db.delete(members).where(inArray(members.id, ids));
    await closeDb();
  });

  test("meetings: emails are sent after the claim transaction is over; every row ends up sent; a second run sends nothing", async () => {
    const s = sender();
    const run = await sendDueReminders(NOW, { send: s.send });
    assert.deepEqual([run.ran, run.emails, run.sent, run.failed, run.deferred], [true, 3, 3, 0, 0]);
    assert.deepEqual(s.tos(), emails.slice(0, 3).sort());
    assert.ok(s.calls.every((c) => c.openTransactions === 0), "no database transaction was open while an email was being sent");
    assert.ok(s.calls.every((c) => c.pendingRows >= 1), "the rows were already claimed (pending) while its email was being sent");
    assert.deepEqual((await rows()).map((r) => r.status), ["sent", "sent", "sent"]);
    const again = sender();
    assert.equal((await sendDueReminders(NOW, { send: again.send })).emails, 0);
    assert.equal(again.calls.length, 0);
  });

  test("meetings: one failing email (an error result, or a thrown error) does not stop the others", async () => {
    await reset();
    const s = sender((mail) => {
      if (mail.to === emails[0]) return { id: null, status: "failed", error: "Greeting never received" };
      if (mail.to === emails[1]) throw new Error("socket exploded");
      return { id: null, status: "sent" };
    });
    const run = await sendDueReminders(NOW, { send: s.send });
    assert.deepEqual([run.emails, run.sent, run.failed], [3, 1, 2]);
    const byMember = new Map((await rows()).map((r) => [r.memberId, r.status]));
    assert.deepEqual([byMember.get(ids[0]), byMember.get(ids[1]), byMember.get(ids[2])], ["failed", "failed", "sent"]);
    assert.equal((await sendDueReminders(NOW, { send: sender().send })).emails, 0, "a failed email is not retried every run");
  });

  test("meetings: at most maxEmails per run, the rest next run; out of time = given back, not lost", async () => {
    await reset();
    const first = sender();
    const run = await sendDueReminders(NOW, { send: first.send, maxEmails: 2 });
    assert.deepEqual([run.emails, run.deferred], [2, 1]);
    const second = sender();
    assert.equal((await sendDueReminders(NOW, { send: second.send, maxEmails: 2 })).emails, 1, "the third one");
    assert.deepEqual([...first.tos(), ...second.tos()].sort(), emails.slice(0, 3).sort());

    await reset();
    const late = sender();
    const out = await sendDueReminders(NOW, { send: late.send, deadline: Date.now() - 1 });
    assert.deepEqual([out.emails, out.deferred, late.calls.length], [0, 3, 0], "no time left: nothing sent");
    assert.equal((await rows()).length, 0, "the claims were released");
    assert.equal((await sendDueReminders(NOW, { send: sender().send })).emails, 3, "the next run sends them");
  });

  test("meetings: a slow mail server uses up the time budget; the unsent rest is given back for the next run", async () => {
    await reset();
    // One email at a time, 200 ms each, 300 ms of budget: the first two go out (started at 0 and 200 ms), the third is out of time.
    const slow = sender(() => new Promise((resolve) => setTimeout(() => resolve({ id: null, status: "sent" }), 200)));
    const run = await sendDueReminders(NOW, { send: slow.send, concurrency: 1, deadline: Date.now() + 300 });
    assert.deepEqual([run.emails, run.deferred, slow.calls.length], [2, 1, 2]);
    assert.deepEqual((await rows()).map((r) => r.status), ["sent", "sent"], "the third was released, not left pending");
    const next = sender();
    assert.equal((await sendDueReminders(NOW, { send: next.send })).emails, 1, "the next run sends the one that was left");
    assert.equal(next.calls.length, 1);
  });

  test("meetings: a pending claim of a run that died is retried after 10 minutes, a recent one is left alone", async () => {
    await reset();
    const old = new Date(NOW.getTime() - 11 * 60_000);
    const recent = new Date(NOW.getTime() - 2 * 60_000);
    await db.insert(meetingReminders).values([
      { meetingId, memberId: ids[0], minutesBefore: 1440, status: "pending", claimedAt: old },
      { meetingId, memberId: ids[1], minutesBefore: 1440, status: "pending", claimedAt: recent },
    ]);
    const s = sender();
    const run = await sendDueReminders(NOW, { send: s.send });
    assert.deepEqual(s.tos(), [emails[0], emails[2]].sort(), "the stale claim is retried, the recent one is another run's");
    assert.equal(run.emails, 2);
    const byMember = new Map((await rows()).map((r) => [r.memberId, r]));
    assert.equal(byMember.get(ids[0])!.status, "sent");
    assert.equal(byMember.get(ids[1])!.status, "pending");
  });

  test("meetings: a run that finds another one holding the lock does nothing", async () => {
    await reset();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const gotLock = new Promise<void>((r) => (locked = r));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('meeting_reminders'))`);
      locked();
      await held;
    });
    await gotLock;
    const s = sender();
    const run = await sendDueReminders(NOW, { send: s.send });
    assert.deepEqual([run.ran, run.emails, s.calls.length], [false, 0, 0]);
    release();
    await holder;
  });

  test("tasks: same shape, a failure does not block the rest, no transaction open while sending, stale claims retried", async () => {
    const due = "2031-03-11"; // due tomorrow: the default 1-day reminder is due at 08:00 Ljubljana on the 10th
    await db.insert(tasks).values(taskTitles.map((title, i) => ({ title, assigneeId: ids[i], dueDate: due })));
    const calls: { to: string; openTransactions: number }[] = [];
    const send = async (mail: OutgoingEmail): Promise<SendResult> => {
      const [open] = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`);
      calls.push({ to: mail.to, openTransactions: open.n });
      if (mail.to === emails[0]) return { id: null, status: "failed", error: "421 busy" };
      return { id: null, status: "sent" };
    };
    const mine = (r: { to: string }) => emails.includes(r.to);
    const run = await sendDueTaskReminders(NOW, { send });
    const ours = calls.filter(mine);
    assert.deepEqual(ours.map((c) => c.to).sort(), emails.slice(0, 3).sort());
    assert.ok(calls.every((c) => c.openTransactions === 0), "no transaction open while sending");
    assert.ok(run.failed >= 1 && run.sent >= 2);
    const status = async () => new Map((await db.select().from(taskReminders).where(inArray(taskReminders.memberId, ids))).map((r) => [r.memberId, r.status]));
    assert.deepEqual([...(await status())].sort(), [[ids[0], "failed"], [ids[1], "sent"], [ids[2], "sent"]].sort());
    assert.equal(calls.length === ours.length ? (await sendDueTaskReminders(NOW, { send })).emails : 0, 0, "nothing is sent twice");

    // A run that died: its claim is retried after 10 minutes.
    await db.delete(taskReminders).where(inArray(taskReminders.memberId, ids));
    const [t1] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.title, taskTitles[0]));
    const [t2] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.title, taskTitles[1]));
    await db.insert(taskReminders).values([
      { taskId: t1.id, memberId: ids[0], dueDate: due, daysBefore: 1, status: "pending", claimedAt: new Date(NOW.getTime() - 11 * 60_000) },
      { taskId: t2.id, memberId: ids[1], dueDate: due, daysBefore: 1, status: "pending", claimedAt: new Date(NOW.getTime() - 60_000) },
    ]);
    calls.length = 0;
    await sendDueTaskReminders(NOW, { send: async () => ({ id: null, status: "sent" }) });
    const after = await status();
    assert.deepEqual([after.get(ids[0]), after.get(ids[1]), after.get(ids[2])], ["sent", "pending", "sent"]);
    await db.delete(taskReminders).where(and(inArray(taskReminders.memberId, ids)));
  });
});
