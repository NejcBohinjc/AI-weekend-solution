import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { displayDescription, parseIcs } from "./ics";

const ALL = { from: new Date("2000-01-01T00:00:00Z"), to: new Date("2100-01-01T00:00:00Z") };

test("reads the sandbox calendar: 55 meetings, series and invitees from the description", () => {
  const { meetings, skipped } = parseIcs(readFileSync("data/meetings.ics", "utf8"), ALL);
  assert.equal(skipped, 0);
  assert.equal(meetings.length, 55);
  const first = meetings[0];
  assert.equal(first.uid, "community-20260914@sandbox.example");
  assert.equal(first.title, "Community meeting");
  assert.equal(first.series, "Community");
  assert.equal(first.startsAt.toISOString(), "2026-09-14T16:00:00.000Z");
  assert.equal(first.endsAt.toISOString(), "2026-09-14T17:30:00.000Z");
  assert.equal(first.location, "Institute, Ljubljana");
  assert.equal(first.emails.length, 20); // the folded "Members:" line, joined back together
  assert.ok(first.emails.includes("katja.lesjak@sandbox.example"));
  assert.equal(first.description, null, "the sandbox description is only the Series/Members lines");
  const series = new Set(meetings.map((m) => m.series));
  assert.deepEqual([...series].sort(), ["Community", "Grants", "Shape Talks", "Shapers Tech", "Shapers Voice", "Summer School"]);
});

// What a Google Calendar export of a weekly meeting looks like: a time zone, a rule, a skipped week,
// one moved occurrence and attendees as ATTENDEE properties.
const GOOGLE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
X-WR-TIMEZONE:Europe/Ljubljana
BEGIN:VTIMEZONE
TZID:Europe/Ljubljana
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=Europe/Ljubljana:20261019T180000
DTEND;TZID=Europe/Ljubljana:20261019T190000
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Europe/Ljubljana:20261102T180000
UID:weekly123@google.com
SUMMARY:Weekly sync
DESCRIPTION:Agenda in the doc.<br>Series: Core team
ATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:Ana.Kovac@sandbox.example
ATTENDEE;CN=Luka;PARTSTAT=NEEDS-ACTION:mailto:luka.novak@sandbox.example
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Ljubljana:20261027T090000
DTEND;TZID=Europe/Ljubljana:20261027T100000
RECURRENCE-ID;TZID=Europe/Ljubljana:20261026T180000
UID:weekly123@google.com
SUMMARY:Weekly sync (moved)
ATTENDEE:mailto:ana.kovac@sandbox.example
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Ljubljana:20261201T100000
DTEND;TZID=Europe/Ljubljana:20261201T110000
UID:cancelled1@google.com
SUMMARY:Cancelled thing
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

test("expands recurring Google events with time zones, skipped weeks and moved occurrences", () => {
  const { meetings } = parseIcs(GOOGLE, ALL);
  const weekly = meetings.filter((m) => m.uid.startsWith("weekly123@google.com#"));
  // 4 weeks, minus the skipped 2 November.
  assert.deepEqual(
    weekly.map((m) => [m.startsAt.toISOString(), m.title]),
    [
      ["2026-10-19T16:00:00.000Z", "Weekly sync"], // 18:00 summer time
      ["2026-10-27T08:00:00.000Z", "Weekly sync (moved)"], // moved to Tuesday 09:00, winter time
      ["2026-11-09T17:00:00.000Z", "Weekly sync"], // 18:00 winter time
    ],
  );
  assert.equal(weekly[0].uid, "weekly123@google.com#2026-10-19T16:00:00.000Z");
  assert.equal(weekly[1].uid, "weekly123@google.com#2026-10-26T17:00:00.000Z"); // keyed by the original slot
  assert.equal(weekly[0].series, "Core team");
  assert.deepEqual(weekly[0].emails, ["ana.kovac@sandbox.example", "luka.novak@sandbox.example"]);
  assert.deepEqual(weekly[1].emails, ["ana.kovac@sandbox.example"]);
  const cancelled = meetings.find((m) => m.uid === "cancelled1@google.com");
  assert.equal(cancelled?.cancelled, true);
  assert.equal(cancelled?.series, "Cancelled thing");
});

test("only expands recurring events inside the window", () => {
  const { meetings } = parseIcs(GOOGLE, { from: new Date("2026-10-20T00:00:00Z"), to: new Date("2026-11-05T00:00:00Z") });
  assert.deepEqual(
    meetings.filter((m) => m.uid.startsWith("weekly123")).map((m) => m.startsAt.toISOString()),
    ["2026-10-27T08:00:00.000Z"],
  );
});

test("reads times without a defined zone as Ljubljana time", () => {
  const text = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:x1
DTSTART;TZID=Europe/Vienna:20261026T180000
DTEND;TZID=Europe/Vienna:20261026T190000
SUMMARY:No VTIMEZONE
END:VEVENT
BEGIN:VEVENT
UID:x2
DTSTART:20260720T180000
SUMMARY:Floating
END:VEVENT
END:VCALENDAR`;
  const { meetings } = parseIcs(text, ALL);
  assert.equal(meetings.find((m) => m.uid === "x1")?.startsAt.toISOString(), "2026-10-26T17:00:00.000Z");
  const floating = meetings.find((m) => m.uid === "x2");
  assert.equal(floating?.startsAt.toISOString(), "2026-07-20T16:00:00.000Z");
  assert.equal(floating?.endsAt.toISOString(), "2026-07-20T17:00:00.000Z"); // no end: one hour
});

function oneEvent(descriptionLines: string[]): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:desc-1@sandbox.example",
    "DTSTART:20261101T170000Z", "DTEND:20261101T180000Z", "SUMMARY:Grants meeting",
    ...descriptionLines, "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

test("description: iCal escapes undone, line breaks kept, Series/Members lines hidden but still used", () => {
  const ics = oneEvent([
    "DESCRIPTION:Series: Grants\\nMembers: ana.kovac@sandbox.example\\, eva.vidmar@sandbox.example\\nAgenda\; budget\\, plan",
    " \\n\\nJoin: https://meet.example.org/abc",
  ]);
  const [m] = parseIcs(ics, ALL).meetings;
  assert.equal(m.series, "Grants");
  assert.deepEqual(m.emails, ["ana.kovac@sandbox.example", "eva.vidmar@sandbox.example"]);
  assert.equal(m.description, "Agenda; budget, plan\n\nJoin: https://meet.example.org/abc");
});

test("description: HTML from Google becomes plain text, links keep their address", () => {
  const html =
    'Hi <b>all</b>,<br>please read <a href="https://docs.example.org/x?a=1&amp;b=2">the doc</a>.<br><ul><li>One</li><li>Two &amp; three</li></ul><script>alert(1)</script>';
  assert.equal(
    displayDescription(html),
    "Hi all,\nplease read the doc (https://docs.example.org/x?a=1&b=2).\n• One\n• Two & three",
  );
});

test("description: leftover literal escapes from double-escaped exports are undone; empty means null", () => {
  assert.equal(displayDescription("Line one\\nLine two\\, with comma\; and semicolon"), "Line one\nLine two, with comma; and semicolon");
  assert.equal(displayDescription("Series: Community\nMembers: a@b.example"), null);
  assert.equal(displayDescription(""), null);
  assert.equal(displayDescription(undefined), null);
});
