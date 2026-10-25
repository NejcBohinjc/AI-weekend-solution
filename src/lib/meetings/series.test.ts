// Database test for deleting a meeting series (e.g. after importing the wrong calendar file), with Slack
// replaced by a fake. Runs only on the *_test database that npm test sets up.
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, db } from "@/db";
import { attendance, meetingInvites, meetings, members, recordings, slackAnnouncements, slackChannels, slackWithdrawals } from "@/db/schema";
import { syncSlackAnnouncements } from "@/lib/slack/announcements";
import { FakeSlack } from "@/lib/slack/fake-slack";
import { testDatabaseSkip } from "@/lib/test-db";
import { deleteSeries, seriesOverview } from "./series";

const slack = new FakeSlack();
const EMAIL = "series-test@sandbox.example";

async function cleanUp() {
  await db.delete(meetings).where(like(meetings.uid, "series-test-%"));
  await db.delete(members).where(eq(members.email, EMAIL));
  await db.delete(slackChannels).where(inArray(slackChannels.series, ["Wrong Series", "Kept Series"]));
  await db.delete(slackWithdrawals);
}

describe("deleting a meeting series", { skip: testDatabaseSkip() }, () => {
  let wrong: number[];
  let kept: number;
  before(async () => {
    await cleanUp();
    const [m] = await db.insert(members).values({ name: "Series Tester", email: EMAIL, tier: "GO!", weeklyHours: 4 }).returning({ id: members.id });
    const rows = await db
      .insert(meetings)
      .values([
        { uid: "series-test-1", title: "Wrong 1", series: "Wrong Series", startsAt: new Date("2026-10-01T17:00:00Z"), endsAt: new Date("2026-10-01T18:00:00Z") },
        { uid: "series-test-2", title: "Wrong 2", series: "Wrong Series", startsAt: new Date("2026-12-01T17:00:00Z"), endsAt: new Date("2026-12-01T18:00:00Z"), status: "removed" },
        { uid: "series-test-3", title: "Kept", series: "Kept Series", startsAt: new Date("2026-12-02T17:00:00Z"), endsAt: new Date("2026-12-02T18:00:00Z") },
      ])
      .returning({ id: meetings.id, uid: meetings.uid });
    wrong = rows.filter((r) => r.uid !== "series-test-3").map((r) => r.id);
    kept = rows.find((r) => r.uid === "series-test-3")!.id;
    await db.insert(meetingInvites).values([...wrong, kept].map((meetingId) => ({ meetingId, memberId: m.id })));
    await db.insert(attendance).values({ meetingId: wrong[0], memberId: m.id, state: "present", source: "seed" });
    await db.insert(slackChannels).values([
      { series: "Wrong Series", channelId: "C1" },
      { series: "Kept Series", channelId: "C1" },
    ]);
    // One announcement already posted in Slack, one still scheduled there.
    slack.members.add("C1");
    const posted = await slack.call("chat.postMessage", { channel: "C1", text: "Wrong 1" });
    const scheduled = await slack.call("chat.scheduleMessage", { channel: "C1", text: "Wrong 2", post_at: 1800000000 });
    await db.insert(slackAnnouncements).values([
      { meetingId: wrong[0], kind: "1d", status: "posted", channelId: "C1", postAt: new Date("2026-09-30T17:00:00Z"), messageTs: String(posted.ts) },
      { meetingId: wrong[1], kind: "3d", status: "scheduled", channelId: "C1", postAt: new Date("2026-11-28T17:00:00Z"), scheduledMessageId: String(scheduled.scheduled_message_id) },
    ]);
  });
  after(async () => {
    await cleanUp();
    await closeDb();
  });

  test("the overview counts meetings, upcoming, active and attendance per series", async () => {
    const row = (await seriesOverview(new Date("2026-10-25T10:00:00Z"))).find((s) => s.series === "Wrong Series")!;
    assert.deepEqual([row.meetings, row.upcoming, row.active, row.attendance, row.recordings], [2, 0, 1, 1, 0]);
  });

  test("a series with recordings is refused", async () => {
    const [rec] = await db.insert(recordings).values({ meetingId: wrong[0] }).returning({ id: recordings.id });
    const result = await deleteSeries("Wrong Series");
    assert.match(result.error ?? "", /1 recording/);
    assert.equal((await db.select().from(meetings).where(inArray(meetings.id, wrong))).length, 2, "nothing deleted");
    await db.delete(recordings).where(eq(recordings.id, rec.id));
  });

  test("deletes the meetings at once without calling Slack; the Slack sync then takes their messages back", async () => {
    const calls = slack.calls.length;
    const result = await deleteSeries("Wrong Series");
    assert.deepEqual(result, { meetings: 2, slackQueued: 2 });
    assert.equal(slack.calls.length, calls, "no Slack call while deleting");
    assert.equal((await db.select().from(slackWithdrawals)).length, 2);

    const report = await syncSlackAnnouncements({ api: slack, now: new Date("2026-10-25T10:00:00Z") });
    assert.equal(report.withdrawn, 2);
    assert.ok(![...slack.scheduled.values()].some((s) => s.text === "Wrong 2"), "the scheduled one is withdrawn");
    assert.ok(!slack.posted.some((p) => p.text === "Wrong 1"), "the posted one is deleted");
    assert.equal((await db.select().from(slackWithdrawals)).length, 0, "the queue is empty");

    assert.equal((await db.select().from(meetings).where(inArray(meetings.id, wrong))).length, 0);
    assert.equal((await db.select().from(attendance).where(inArray(attendance.meetingId, wrong))).length, 0);
    assert.equal((await db.select().from(slackAnnouncements).where(inArray(slackAnnouncements.meetingId, wrong))).length, 0);
    assert.deepEqual((await db.select().from(slackChannels).where(inArray(slackChannels.series, ["Wrong Series", "Kept Series"]))).map((c) => c.series), ["Kept Series"]);
    assert.equal((await db.select().from(meetings).where(eq(meetings.id, kept))).length, 1);
    assert.match((await deleteSeries("Wrong Series")).error ?? "", /no meetings/);
  });
});
