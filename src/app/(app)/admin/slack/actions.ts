"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { members, slackChannels, slackMembers } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { runSlackSync, type SlackSyncReport } from "@/lib/slack/announcements";
import { slackClient } from "@/lib/slack/client";

export type SlackActionState = { saved?: boolean; summary?: string; error?: string } | null;

function summarize(report: SlackSyncReport | null): SlackActionState {
  if (!report) return { error: "Another sync is running right now. Try again in a moment." };
  const done = [
    report.scheduled && `${report.scheduled} scheduled`,
    report.rescheduled && `${report.rescheduled} rescheduled`,
    report.postedNow && `${report.postedNow} posted now`,
    report.cancelled && `${report.cancelled} cancelled`,
    report.withdrawn && `${report.withdrawn} of deleted meetings taken back`,
  ].filter(Boolean);
  const summary =
    (done.length ? done.join(", ") : report.more ? "Started" : "Everything was already up to date") +
    // Slack allows only so many calls a minute: the rest follows in the next runs (every few minutes).
    (report.more ? "; more to do, it continues by itself in a few minutes (or press Sync again)" : "");
  if (!report.ok) return { summary, error: report.error ?? report.problems.map((p) => `${p.meeting}: ${p.error}`).join("; ") };
  return { saved: true, summary };
}

/** Channel per series ("channel:<series>" = "<id>|<name>" or "" for none). Then syncs at once. */
export async function saveChannelsAction(_prev: SlackActionState, formData: FormData): Promise<SlackActionState> {
  await requireAdmin();
  const api = slackClient();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("channel:")) continue;
    const series = key.slice("channel:".length);
    const [channelId, channelName] = String(value).split("|");
    if (!channelId) {
      await db.delete(slackChannels).where(eq(slackChannels.series, series));
      continue;
    }
    await db
      .insert(slackChannels)
      .values({ series, channelId, channelName: channelName || null })
      .onConflictDoUpdate({ target: slackChannels.series, set: { channelId, channelName: channelName || null, updatedAt: new Date() } });
    // The app has to be in a channel to post there; public channels it can join itself.
    await api?.call("conversations.join", { channel: channelId }).catch(() => {});
  }
  const result = summarize(await runSlackSync({ force: true }));
  revalidatePath("/admin/slack");
  return result;
}

/** Who each member is on Slack ("slack:<member id>" = "auto" (by email), "none", or a Slack user id). */
export async function savePeopleAction(_prev: SlackActionState, formData: FormData): Promise<SlackActionState> {
  await requireAdmin();
  const active = new Set((await db.select({ id: members.id }).from(members).where(eq(members.active, true))).map((m) => m.id));
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("slack:")) continue;
    const memberId = Number(key.slice("slack:".length));
    if (!active.has(memberId)) continue;
    const choice = String(value);
    if (choice === "auto") {
      await db.delete(slackMembers).where(eq(slackMembers.memberId, memberId)); // looked up by email again
      continue;
    }
    const slackUserId = choice === "none" ? null : choice;
    await db
      .insert(slackMembers)
      .values({ memberId, slackUserId, manual: true })
      .onConflictDoUpdate({ target: slackMembers.memberId, set: { slackUserId, manual: true, checkedAt: new Date() } });
  }
  // Mentions changed: scheduled announcements are rescheduled with the new text.
  const result = summarize(await runSlackSync({ force: true }));
  revalidatePath("/admin/slack");
  return result;
}

export async function syncSlackNowAction(_prev: SlackActionState): Promise<SlackActionState> {
  await requireAdmin();
  const result = summarize(await runSlackSync({ force: true }));
  revalidatePath("/admin/slack");
  return result;
}
