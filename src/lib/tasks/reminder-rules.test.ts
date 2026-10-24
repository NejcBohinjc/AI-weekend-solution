import assert from "node:assert/strict";
import { test } from "node:test";
import { dueTaskReminders, dueWhen, taskReminderAt, taskReminderEmail } from "./reminder-rules";

// Due Tuesday 27 Oct 2026 (Ljubljana is UTC+1 from 25 Oct, UTC+2 before).
const DUE = "2026-10-27";
const at = (iso: string) => new Date(iso);

test("a reminder goes out at 08:00 Ljubljana time, the chosen number of days before the due date", () => {
  assert.equal(taskReminderAt(DUE, 1).toISOString(), "2026-10-26T07:00:00.000Z");
  assert.equal(taskReminderAt(DUE, 0).toISOString(), "2026-10-27T07:00:00.000Z");
  assert.equal(taskReminderAt(DUE, 3).toISOString(), "2026-10-24T06:00:00.000Z", "summer time before 25 Oct");
});

test("due reminders: once their moment has passed, not handled, and only until the due day is over", () => {
  assert.deepEqual(dueTaskReminders(DUE, [1], [], at("2026-10-26T06:59:00Z")), []);
  assert.deepEqual(dueTaskReminders(DUE, [1], [], at("2026-10-26T07:00:00Z")), [1]);
  assert.deepEqual(dueTaskReminders(DUE, [1], [1], at("2026-10-26T09:00:00Z")), [], "already sent");
  // A due date set late: the missed reminders are due together (one email), the later one not yet.
  assert.deepEqual(dueTaskReminders(DUE, [3, 1, 0], [], at("2026-10-26T12:00:00Z")), [1, 3]);
  assert.deepEqual(dueTaskReminders(DUE, [0], [], at("2026-10-27T22:30:00Z")), [0], "23:30 on the due day still counts");
  assert.deepEqual(dueTaskReminders(DUE, [0, 1], [], at("2026-10-27T23:30:00Z")), [], "never after the due day");
  assert.deepEqual(dueTaskReminders(DUE, [], [], at("2026-10-26T12:00:00Z")), [], "reminders turned off");
});

test("says when the task is due", () => {
  assert.equal(dueWhen(DUE, at("2026-10-27T10:00:00Z")), "today");
  assert.equal(dueWhen(DUE, at("2026-10-26T07:00:00Z")), "tomorrow");
  assert.equal(dueWhen(DUE, at("2026-10-24T06:00:00Z")), "in 3 days");
  assert.equal(dueWhen(DUE, at("2026-10-26T23:30:00Z")), "today", "00:30 in Ljubljana is already the due day");
});

test("the email names the task, when it is due, its priority and the link; HTML is escaped", () => {
  const now = at("2026-10-26T07:05:00Z");
  const task = { title: "Poster <A3>", dueDate: DUE, priority: "urgent" as const, status: "in_progress" as const, projectName: "Summer School", departmentName: null };
  const mail = taskReminderEmail(task, "Ana Kovač", "https://hub.example/tasks/7", now);
  assert.equal(mail.subject, "Urgent, due tomorrow: Poster <A3>");
  assert.match(mail.text, /^Hi Ana,/);
  assert.match(mail.text, /"Poster <A3>" is due tomorrow \(Tuesday 27 October\)\./);
  assert.match(mail.text, /Priority: Urgent · Status: In progress · Project: Summer School/);
  assert.match(mail.text, /https:\/\/hub\.example\/tasks\/7/);
  assert.match(mail.text, /the task is yours/);
  assert.match(mail.html, /Poster &lt;A3&gt;/);
  assert.ok(!mail.html.includes("<A3>"));

  const dept = taskReminderEmail({ ...task, priority: "medium", departmentName: "Tech", projectName: null }, "Bor Novak", "https://hub.example/tasks/8", now);
  assert.equal(dept.subject, "Due tomorrow: Poster <A3>");
  assert.match(dept.text, /delegated to the Tech department: anyone in it can take it/);
  assert.match(dept.text, /your department's/);
  assert.ok(!dept.text.includes("Project:"));
});
