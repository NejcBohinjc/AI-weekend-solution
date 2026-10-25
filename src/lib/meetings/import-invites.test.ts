// Database test (runs on the *_test database that npm test sets up): the calendar import keeps each meeting's
// invites in step with the calendar, rewriting them only when they changed.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { attendance, meetingInvites, meetings, members } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import type { ParsedMeeting } from "./ics";
import { importMeetings } from "./import";

const stamp = Date.now();
const uid = (n: number) => `import-invites-${stamp}-${n}@sandbox.example`;
const emails = [1, 2, 3].map((i) => `imp.${i}.${stamp}@sandbox.example`);
let ids: number[] = [];

const meeting = (n: number, who: string[], over: Partial<ParsedMeeting> = {}): ParsedMeeting => ({
  uid: uid(n),
  title: `Import test ${n}`,
  series: "Import test",
  startsAt: new Date(`2026-12-0${n}T15:00:00Z`),
  endsAt: new Date(`2026-12-0${n}T16:00:00Z`),
  location: null,
  description: null,
  cancelled: false,
  emails: who,
  ...over,
});
const run = (parsed: ParsedMeeting[]) => importMeetings(parsed, { source: "file", actorId: null, wholeCalendar: false });
const invitedTo = async (n: number) => {
  const [m] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.uid, uid(n)));
  const rows = await db.select({ email: members.email }).from(meetingInvites).innerJoin(members, eq(meetingInvites.memberId, members.id)).where(eq(meetingInvites.meetingId, m.id));
  return rows.map((r) => r.email).sort();
};

describe("calendar import and invites", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    ids = (await db.insert(members).values(emails.map((email, i) => ({ name: `Import ${i}`, email, tier: "GO!" as const, weeklyHours: 4 }))).returning({ id: members.id })).map((r) => r.id);
  });
  after(async () => {
    const ms = await db.select({ id: meetings.id }).from(meetings).where(like(meetings.uid, `import-invites-${stamp}-%`));
    if (ms.length) await db.delete(meetings).where(inArray(meetings.id, ms.map((m) => m.id)));
    await db.delete(members).where(inArray(members.id, ids));
    await closeDb();
  });

  test("a first import creates the invites; the same import again changes nothing", async () => {
    const first = await run([meeting(1, [emails[0], emails[1]]), meeting(2, [emails[2]])]);
    assert.deepEqual([first.created, first.invites], [2, 3]);
    assert.deepEqual(await invitedTo(1), [emails[0], emails[1]].sort());
    const again = await run([meeting(1, [emails[0], emails[1]]), meeting(2, [emails[2]])]);
    assert.deepEqual([again.created, again.unchanged, again.invites], [0, 2, 3]);
    assert.deepEqual(await invitedTo(1), [emails[0], emails[1]].sort());
    assert.deepEqual(await invitedTo(2), [emails[2]]);
  });

  test("someone added, someone removed, everyone removed, and unknown addresses reported", async () => {
    await run([meeting(1, [emails[1], emails[2]]), meeting(2, [])]);
    assert.deepEqual(await invitedTo(1), [emails[1], emails[2]].sort(), "emails[0] out, emails[2] in");
    assert.deepEqual(await invitedTo(2), [], "no one is invited any more");
    const report = await run([meeting(1, [emails[1], emails[2], `nobody.${stamp}@sandbox.example`])]);
    assert.deepEqual(report.unknownEmails.map((u) => u.email), [`nobody.${stamp}@sandbox.example`]);
    assert.deepEqual(await invitedTo(1), [emails[1], emails[2]].sort());
  });

  test("attendance already recorded is kept when the invites are rewritten", async () => {
    const [m] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.uid, uid(1)));
    await db.insert(attendance).values({ meetingId: m.id, memberId: ids[1], state: "present", source: "admin" });
    await run([meeting(1, [emails[0], emails[1]])]);
    assert.deepEqual(await invitedTo(1), [emails[0], emails[1]].sort());
    const rows = await db.select({ state: attendance.state }).from(attendance).where(eq(attendance.meetingId, m.id));
    assert.deepEqual(rows, [{ state: "present" }]);
  });
});
