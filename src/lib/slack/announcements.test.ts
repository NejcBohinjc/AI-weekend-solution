// Database test for Slack meeting announcements, with Slack replaced by an in-memory fake.
// Runs only on the *_test database that npm test sets up.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { meetingInvites, meetings, members, slackAnnouncements, slackChannels } from "@/db/schema";
import { testDatabaseSkip } from "@/lib/test-db";
import { syncSlackAnnouncements } from "./announcements";
import { FakeSlack } from "./fake-slack";

const slack = new FakeSlack();
const EMAILS = ["slack-ana@sandbox.example", "slack-bor@sandbox.example"];
const run = (iso: string) => syncSlackAnnouncements({ api: slack, now: new Date(iso) });
const statuses = async (meetingId: number) =>
  Object.fromEntries((await db.select().from(slackAnnouncements).where(eq(slackAnnouncements.meetingId, meetingId))).map((r) => [r.kind, r.status]));
let far: number;
let soon: number;

async function cleanUp() {
  await db.delete(meetings).where(like(meetings.uid, "slack-test-%"));
  await db.delete(members).where(inArray(members.email, EMAILS));
  await db.delete(slackChannels);
}

describe("Slack meeting announcements", { skip: testDatabaseSkip() }, () => {
  before(async () => {
    process.env.APP_URL ||= "http://localhost:3000";
    await cleanUp();
    const people = await db
      .insert(members)
      .values(EMAILS.map((email, i) => ({ name: `Slack Tester ${i}`, email, tier: "Impact" as const, weeklyHours: 10 })))
      .returning({ id: members.id });
    slack.users.set(EMAILS[0], "U_ANA"); // the other one is not on Slack
    const rows = await db
      .insert(meetings)
      .values([
        { uid: "slack-test-far", title: "Grants meeting", series: "Slack Test Grants", startsAt: new Date("2026-11-10T17:00:00Z"), endsAt: new Date("2026-11-10T18:00:00Z") },
        { uid: "slack-test-soon", title: "Tech meeting", series: "Slack Test Tech", startsAt: new Date("2026-11-03T10:00:00Z"), endsAt: new Date("2026-11-03T11:00:00Z") },
        { uid: "slack-test-now", title: "Starting now", series: "Slack Test Grants", startsAt: new Date("2026-11-01T10:30:00Z"), endsAt: new Date("2026-11-01T11:00:00Z") },
        { uid: "slack-test-nochannel", title: "Voice meeting", series: "Slack Test Voice", startsAt: new Date("2026-11-20T17:00:00Z"), endsAt: new Date("2026-11-20T18:00:00Z") },
      ])
      .returning({ id: meetings.id, uid: meetings.uid });
    far = rows.find((r) => r.uid === "slack-test-far")!.id;
    soon = rows.find((r) => r.uid === "slack-test-soon")!.id;
    await db.insert(meetingInvites).values(people.map((p) => ({ meetingId: far, memberId: p.id })));
    await db.insert(slackChannels).values([
      { series: "Slack Test Grants", channelId: "C_GRANTS" },
      { series: "Slack Test Tech", channelId: "C_TECH" },
    ]);
  });
  after(async () => {
    await cleanUp();
    await closeDb();
  });

  test("schedules 3 days and 1 day before, mentions people on Slack, joins the channel; posts a missed one now", async () => {
    const report = await run("2026-11-01T10:00:00Z");
    assert.ok(slack.calls.some((c) => c.method === "conversations.join" && c.params.channel === "C_GRANTS"), "joined the channel");
    const farMsgs = [...slack.scheduled.values()].filter((s) => s.channel === "C_GRANTS").sort((a, b) => a.post_at - b.post_at);
    assert.deepEqual(
      farMsgs.map((s) => new Date(s.post_at * 1000).toISOString()),
      ["2026-11-07T17:00:00.000Z", "2026-11-09T17:00:00.000Z"],
    );
    assert.match(farMsgs[0].text, /starts on Tue 10 Nov at 18:00/);
    assert.match(farMsgs[1].text, /starts tomorrow at 18:00/);
    assert.match(farMsgs[1].text, /Invited: <@U_ANA> and 1 more/);
    assert.match(farMsgs[1].text, new RegExp(`/meetings/${far}\\|`));

    // The Tech meeting is in 2 days: "3 days before" has passed and goes out now, "1 day before" is scheduled.
    assert.equal(slack.posted.filter((p) => p.channel === "C_TECH").length, 1);
    assert.match(slack.posted[0].text, /Tech meeting\* \(Slack Test Tech\) starts on Tue 3 Nov at 11:00/);
    assert.deepEqual(await statuses(soon), { "3d": "posted", "1d": "scheduled" });

    assert.equal(report.scheduled, 3);
    assert.equal(report.postedNow, 1);
    assert.ok(report.noChannel.includes("Slack Test Voice"));
    assert.ok(!slack.posted.some((p) => p.text.includes("Starting now")), "nothing for a meeting starting within the hour");
  });

  test("a second run changes nothing", async () => {
    const calls = slack.calls.length;
    const report = await run("2026-11-01T10:05:00Z");
    assert.equal(report.scheduled + report.rescheduled + report.postedNow + report.cancelled, 0);
    assert.deepEqual(slack.calls.slice(calls).map((c) => c.method), []);
  });

  test("a moved meeting is rescheduled, a cancelled one deleted from Slack", async () => {
    await db.update(meetings).set({ startsAt: new Date("2026-11-11T17:00:00Z"), endsAt: new Date("2026-11-11T18:00:00Z") }).where(eq(meetings.id, far));
    let report = await run("2026-11-01T10:30:00Z");
    assert.equal(report.rescheduled, 2);
    const grants = [...slack.scheduled.values()].filter((s) => s.channel === "C_GRANTS");
    assert.deepEqual(grants.map((s) => new Date(s.post_at * 1000).toISOString()).sort(), ["2026-11-08T17:00:00.000Z", "2026-11-10T17:00:00.000Z"]);

    await db.update(meetings).set({ status: "cancelled" }).where(eq(meetings.id, far));
    report = await run("2026-11-01T11:00:00Z");
    assert.equal(report.cancelled, 2);
    assert.equal([...slack.scheduled.values()].filter((s) => s.channel === "C_GRANTS").length, 0);
    assert.deepEqual(await statuses(far), { "3d": "cancelled", "1d": "cancelled" });
  });

  test("once Slack has posted a scheduled message it is marked posted", async () => {
    slack.deliverUntil(new Date("2026-11-02T10:00:00Z"));
    await run("2026-11-02T10:05:00Z");
    assert.deepEqual(await statuses(soon), { "3d": "posted", "1d": "posted" });
  });

  test("Slack errors are reported per meeting and kept on the announcement", async () => {
    await db.update(meetings).set({ status: "confirmed" }).where(eq(meetings.id, far));
    slack.failWith = "channel_not_found";
    const report = await run("2026-11-02T11:00:00Z");
    slack.failWith = null;
    assert.equal(report.ok, false);
    assert.match(report.problems[0].error, /channel_not_found/);
    const [row] = await db.select().from(slackAnnouncements).where(eq(slackAnnouncements.meetingId, far)).limit(1);
    assert.match(row.error ?? "", /channel_not_found/);
    const again = await run("2026-11-02T11:05:00Z");
    assert.ok(again.ok, JSON.stringify(again.problems));
    assert.deepEqual(await statuses(far), { "3d": "scheduled", "1d": "scheduled" });
  });
});
