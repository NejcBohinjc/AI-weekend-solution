import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceSummary, dueReminders, effectiveState, meetingPhase, memberActions, reminderEmail, whenPhrase } from "./rules";

// Monday 26 Oct 2026, 18:00-19:30 in Ljubljana (winter time).
const m = { startsAt: new Date("2026-10-26T17:00:00Z"), endsAt: new Date("2026-10-26T18:30:00Z") };
const at = (iso: string) => new Date(iso);

test("check-in opens 15 minutes before the start and closes 15 minutes after the end", () => {
  assert.equal(meetingPhase(m, at("2026-10-26T16:44:00Z")), "upcoming");
  assert.equal(meetingPhase(m, at("2026-10-26T16:45:00Z")), "open");
  assert.equal(meetingPhase(m, at("2026-10-26T18:45:00Z")), "open");
  assert.equal(meetingPhase(m, at("2026-10-26T18:46:00Z")), "past");
});

test("nothing recorded counts as unexcused once check-in has closed", () => {
  assert.equal(effectiveState(null, m, at("2026-10-26T12:00:00Z")), null);
  assert.equal(effectiveState(null, m, at("2026-10-26T18:00:00Z")), null);
  assert.equal(effectiveState(null, m, at("2026-10-27T08:00:00Z")), "unexcused");
  assert.equal(effectiveState("excused", m, at("2026-10-27T08:00:00Z")), "excused");
  assert.equal(effectiveState("remote", m, at("2026-10-26T17:10:00Z")), "remote");
});

test("members check in during the meeting and send excuses until a day after it", () => {
  const meeting = { ...m, cancelled: false };
  assert.deepEqual(memberActions(meeting, at("2026-10-20T08:00:00Z")), { checkIn: false, excuse: true });
  assert.deepEqual(memberActions(meeting, at("2026-10-26T17:30:00Z")), { checkIn: true, excuse: true });
  assert.deepEqual(memberActions(meeting, at("2026-10-27T18:00:00Z")), { checkIn: false, excuse: true });
  assert.deepEqual(memberActions(meeting, at("2026-10-27T18:31:00Z")), { checkIn: false, excuse: false });
  assert.deepEqual(memberActions({ ...meeting, cancelled: true }, at("2026-10-26T17:30:00Z")), { checkIn: false, excuse: false });
});

test("reminders are due once their moment passes, once each, never after the start", () => {
  const choices = [1440, 10];
  assert.deepEqual(dueReminders(m.startsAt, choices, [], at("2026-10-25T16:59:00Z")), []);
  assert.deepEqual(dueReminders(m.startsAt, choices, [], at("2026-10-25T17:00:00Z")), [1440]);
  assert.deepEqual(dueReminders(m.startsAt, choices, [1440], at("2026-10-26T12:00:00Z")), []);
  assert.deepEqual(dueReminders(m.startsAt, choices, [1440], at("2026-10-26T16:52:00Z")), [10]);
  // Imported 5 minutes before the start: both are overdue, handled together.
  assert.deepEqual(dueReminders(m.startsAt, choices, [], at("2026-10-26T16:55:00Z")), [10, 1440]);
  assert.deepEqual(dueReminders(m.startsAt, choices, [], at("2026-10-26T17:00:00Z")), []);
});

test("says when the meeting starts in words", () => {
  assert.equal(whenPhrase(m.startsAt, at("2026-10-26T16:50:00Z")), "in 10 minutes");
  assert.equal(whenPhrase(m.startsAt, at("2026-10-26T14:00:00Z")), "in 3 hours");
  assert.equal(whenPhrase(m.startsAt, at("2026-10-26T07:00:00Z")), "today at 18:00");
  assert.equal(whenPhrase(m.startsAt, at("2026-10-25T17:00:00Z")), "tomorrow at 18:00");
  assert.equal(whenPhrase(m.startsAt, at("2026-10-23T17:00:00Z")), "on Mon 26 Oct at 18:00");
});

test("builds the reminder email", () => {
  const mail = reminderEmail(
    { ...m, title: "Community <meeting>", series: "Community", location: "Institute, Ljubljana" },
    "Ana Kovač",
    "https://hub.example/meetings/7",
    at("2026-10-25T17:00:00Z"),
  );
  assert.equal(mail.subject, "Reminder: Community <meeting> tomorrow at 18:00");
  assert.match(mail.text, /^Hi Ana,/);
  assert.match(mail.text, /When: Monday 26 October, 18:00–19:30/);
  assert.match(mail.text, /Where: Institute, Ljubljana/);
  assert.match(mail.text, /https:\/\/hub\.example\/meetings\/7/);
  assert.match(mail.html, /Community &lt;meeting&gt;/); // escaped in HTML
});

test("summarises attendance", () => {
  assert.deepEqual(attendanceSummary(["present", "remote", "excused", "unexcused", null]), {
    present: 1,
    remote: 1,
    excused: 1,
    unexcused: 1,
    total: 4,
    attended: 2,
    rate: 50,
  });
  assert.equal(attendanceSummary([]).rate, null);
});
