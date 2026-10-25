// Meeting announcements in Slack: what to post and what to do with each announcement. Pure (no I/O),
// so it is unit-tested (announce-rules.test.ts).
import { createHash } from "node:crypto";
import { TIMEZONE } from "@/lib/app";
import { ljubljanaParts } from "@/lib/hours/time";
import { whenPhrase } from "@/lib/meetings/rules";
import { LATE_POST_MIN_MINUTES_BEFORE, SLACK_SCHEDULE_MAX_DAYS, type AnnouncementStatus } from "./constants";

const MIN = 60_000;

/** Slack mrkdwn needs &, < and > escaped in text that is not markup. */
export const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type AnnouncedMeeting = { title: string; series: string; startsAt: Date; endsAt: Date; location: string | null };

/**
 * The announcement, as Slack sees it at `at` (when it is posted): title, when, where, the invitees on
 * Slack as mentions (others counted), and a link to the meeting in the app.
 */
export function announcementText(m: AnnouncedMeeting, slackUserIds: string[], othersInvited: number, url: string, at: Date): string {
  const s = ljubljanaParts(m.startsAt);
  const e = ljubljanaParts(m.endsAt);
  const day = m.startsAt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE });
  const mentions = slackUserIds.map((id) => `<@${id}>`);
  const invited = mentions.length
    ? `Invited: ${mentions.join(", ")}${othersInvited ? ` and ${othersInvited} more` : ""}`
    : othersInvited
      ? `${othersInvited} invited`
      : null;
  return [
    `:calendar: *${escapeSlack(m.title)}* (${escapeSlack(m.series)}) starts ${whenPhrase(m.startsAt, at)}`,
    `${day}, ${s.time}–${e.time}${m.location ? ` · ${escapeSlack(m.location)}` : ""}`,
    ...(invited ? [invited] : []),
    `<${url}|Check in or send an excuse in Shapers Hub>`,
  ].join("\n");
}

export const contentHash = (channelId: string, text: string) => createHash("sha1").update(`${channelId}\n${text}`).digest("hex").slice(0, 16);

export type ExistingAnnouncement = { status: AnnouncementStatus; postAt: Date; channelId: string | null; contentHash: string | null } | null;

export type AnnouncementAction =
  | { type: "none" }
  | { type: "schedule"; replace: boolean } // replace: delete the scheduled one first
  | { type: "post_now"; replace: boolean } // its moment has passed: post it now (one message per meeting)
  | { type: "mark_posted" } // Slack has posted the scheduled message
  | { type: "cancel" }; // delete the scheduled message (meeting cancelled, moved past, or no channel)

/**
 * What to do with one announcement (e.g. "1 day before") of one meeting.
 * `wanted`: the channel and content it should have now, or null when there is no channel for it.
 */
export function decideAnnouncement(
  m: { startsAt: Date; confirmed: boolean },
  minutesBefore: number,
  existing: ExistingAnnouncement,
  wanted: { channelId: string; hash: string } | null,
  now: Date,
): AnnouncementAction {
  if (existing?.status === "posted") return { type: "none" };
  const scheduled = existing?.status === "scheduled";
  // Slack posted it at its time (the meeting may have moved since: a posted message stays posted).
  if (scheduled && existing.postAt <= now) return { type: "mark_posted" };
  if (!m.confirmed || m.startsAt <= now || !wanted) return scheduled ? { type: "cancel" } : { type: "none" };

  const postAt = new Date(m.startsAt.getTime() - minutesBefore * MIN);
  if (postAt.getTime() > now.getTime() + MIN) {
    if (postAt.getTime() > now.getTime() + SLACK_SCHEDULE_MAX_DAYS * 24 * 60 * MIN) return { type: "none" }; // a later run schedules it
    const same = scheduled && existing.postAt.getTime() === postAt.getTime() && existing.channelId === wanted.channelId && existing.contentHash === wanted.hash;
    return same ? { type: "none" } : { type: "schedule", replace: scheduled };
  }
  // Its moment has passed (the meeting was added or moved late, or Slack was just set up): post it now,
  // unless the meeting is about to start.
  if (m.startsAt.getTime() - now.getTime() < LATE_POST_MIN_MINUTES_BEFORE * MIN) return scheduled ? { type: "cancel" } : { type: "none" };
  return { type: "post_now", replace: scheduled };
}
