import assert from "node:assert/strict";
import { test } from "node:test";
import { announcementText, decideAnnouncement, escapeSlack } from "./announce-rules";

const DAY = 24 * 60;
const start = new Date("2026-11-10T17:00:00Z"); // Tuesday 18:00 in Ljubljana
const m = { startsAt: start, confirmed: true };
const wanted = { channelId: "C1", hash: "h1" };
const at = (iso: string) => new Date(iso);
const sched = (postAt: Date, over: object = {}) => ({ status: "scheduled" as const, postAt, channelId: "C1", contentHash: "h1", ...over });

test("schedules an announcement whose moment is ahead, and leaves it alone while nothing changed", () => {
  const now = at("2026-11-01T10:00:00Z");
  assert.deepEqual(decideAnnouncement(m, 3 * DAY, null, wanted, now), { type: "schedule", replace: false });
  assert.deepEqual(decideAnnouncement(m, 3 * DAY, sched(at("2026-11-07T17:00:00Z")), wanted, now), { type: "none" });
});

test("reschedules when the meeting moved, the channel or the text changed", () => {
  const now = at("2026-11-01T10:00:00Z");
  assert.deepEqual(decideAnnouncement(m, DAY, sched(at("2026-11-08T17:00:00Z")), wanted, now), { type: "schedule", replace: true }, "moved");
  assert.deepEqual(decideAnnouncement(m, DAY, sched(at("2026-11-09T17:00:00Z"), { channelId: "C2" }), wanted, now), { type: "schedule", replace: true });
  assert.deepEqual(decideAnnouncement(m, DAY, sched(at("2026-11-09T17:00:00Z"), { contentHash: "old" }), wanted, now), { type: "schedule", replace: true });
});

test("cancels the scheduled one for a cancelled meeting or when the channel is removed", () => {
  const now = at("2026-11-01T10:00:00Z");
  assert.deepEqual(decideAnnouncement({ ...m, confirmed: false }, DAY, sched(at("2026-11-09T17:00:00Z")), wanted, now), { type: "cancel" });
  assert.deepEqual(decideAnnouncement(m, DAY, sched(at("2026-11-09T17:00:00Z")), null, now), { type: "cancel" });
  assert.deepEqual(decideAnnouncement({ ...m, confirmed: false }, DAY, null, wanted, now), { type: "none" });
});

test("a scheduled message whose time has come counts as posted; posted ones are never touched", () => {
  const now = at("2026-11-09T17:05:00Z");
  assert.deepEqual(decideAnnouncement(m, DAY, sched(at("2026-11-09T17:00:00Z")), wanted, now), { type: "mark_posted" });
  assert.deepEqual(decideAnnouncement({ ...m, confirmed: false }, DAY, { ...sched(at("2026-11-09T17:00:00Z")), status: "posted" }, wanted, now), { type: "none" });
});

test("a missed moment is posted now, unless the meeting starts within the hour", () => {
  assert.deepEqual(decideAnnouncement(m, 3 * DAY, null, wanted, at("2026-11-08T10:00:00Z")), { type: "post_now", replace: false });
  assert.deepEqual(decideAnnouncement(m, 3 * DAY, { ...sched(start), status: "failed" }, wanted, at("2026-11-08T10:00:00Z")), { type: "post_now", replace: false });
  assert.deepEqual(decideAnnouncement(m, DAY, null, wanted, at("2026-11-10T16:30:00Z")), { type: "none" });
  assert.deepEqual(decideAnnouncement(m, DAY, null, wanted, at("2026-11-10T18:00:00Z")), { type: "none" }, "already started");
});

test("waits with announcements more than 120 days ahead (Slack's limit)", () => {
  const far = { startsAt: at("2027-06-01T17:00:00Z"), confirmed: true };
  assert.deepEqual(decideAnnouncement(far, DAY, null, wanted, at("2026-11-01T10:00:00Z")), { type: "none" });
});

test("the text: title, when as seen at posting time, mentions, others counted, link; Slack markup escaped", () => {
  const meeting = { title: "Grants <draft> & budget", series: "Grants", startsAt: start, endsAt: at("2026-11-10T18:00:00Z"), location: "Room 2" };
  const text = announcementText(meeting, ["U1", "U2"], 3, "https://hub.example/meetings/7", at("2026-11-09T17:00:00Z"));
  assert.equal(
    text,
    [
      ":calendar: *Grants &lt;draft&gt; &amp; budget* (Grants) starts tomorrow at 18:00",
      "Tuesday 10 November, 18:00–19:00 · Room 2",
      "Invited: <@U1>, <@U2> and 3 more",
      "<https://hub.example/meetings/7|Check in or send an excuse in Shapers Hub>",
    ].join("\n"),
  );
  assert.match(announcementText(meeting, [], 4, "u", at("2026-11-07T17:00:00Z")), /starts on Tue 10 Nov at 18:00\n.*\n4 invited\n/);
  assert.equal(escapeSlack("a<b>&c"), "a&lt;b&gt;&amp;c");
});
