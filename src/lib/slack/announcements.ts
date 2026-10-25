// Meeting announcements in Slack, 3 days and 1 day before each meeting (an extra: only with
// SLACK_BOT_TOKEN). Each announcement is a Slack scheduled message (chat.scheduleMessage), so nothing
// has to run at the moment it is posted. A run keeps them in step with the meetings: new meetings are
// scheduled, moved or changed ones rescheduled, cancelled ones deleted; one whose moment has passed is
// posted right away. Runs after the calendar sync (page loads), from the scheduled job and on "Sync now".
//
// Taking messages back: deleting meetings (a whole series) only queues their messages in
// slack_withdrawals; each run first works through that queue. Messages that belong to no meeting at all
// (meetings deleted in the database directly) are found by listing the app's scheduled messages in
// Slack, on "Sync now" and at most once an hour otherwise.
//
// A run makes at most CALLS_PER_RUN Slack calls and stops politely when Slack asks it to slow down, so
// a big import or delete is spread over several runs instead of one long one.
import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { meetingInvites, meetings, members, slackAnnouncements, slackChannels, slackMembers, slackWithdrawals, type SlackAnnouncement } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { acquireSync, finishSync, getSyncState, recordSyncResult } from "@/lib/sync-state";
import { announcementText, contentHash, decideAnnouncement } from "./announce-rules";
import { describeSlackError, slackClient, SlackError, type SlackApi } from "./client";
import { ANNOUNCEMENT_KINDS, DEFAULT_SERIES, SLACK_SCHEDULE_MAX_DAYS, SLACK_SYNC_SECONDS, type AnnouncementKind } from "./constants";

export const SLACK_SYNC = "slack_announcements";
/** sync_state row: when the app's scheduled messages in Slack were last checked for leftovers. */
export const SLACK_LEFTOVERS = "slack_leftovers";
const DAY = 24 * 60 * 60_000;
/** A member not found on Slack by email is looked up again after this long. */
const LOOKUP_AGAIN_MS = 6 * 60 * 60_000;
/** Slack allows about 50 calls a minute for most methods: one run stays below that. */
export const CALLS_PER_RUN = 45;
/** Background runs look for leftover scheduled messages at most this often ("Sync now" always does). */
const LEFTOVER_SCAN_MS = 60 * 60_000;
/** A withdrawal that keeps failing is given up after this many tries (it is reported each time). */
const MAX_WITHDRAW_ATTEMPTS = 3;
/** Slack's answers for a message that is already gone: nothing left to do. */
const ALREADY_GONE = ["invalid_scheduled_message_id", "message_not_found", "channel_not_found", "is_archived"];

export type SlackSyncReport = {
  ok: boolean;
  error?: string;
  scheduled: number;
  rescheduled: number;
  postedNow: number;
  cancelled: number;
  withdrawn: number; // messages of deleted meetings taken back (queued or leftovers found in Slack)
  problems: { meeting: string; error: string }[];
  more?: boolean; // the run stopped at its call limit (or Slack asked to slow down); the next one continues
  scanned?: boolean; // the leftover check in Slack ran to the end
  noChannel: string[]; // series without a channel (and no default)
};

const emptyReport = (): SlackSyncReport => ({ ok: true, scheduled: 0, rescheduled: 0, postedNow: 0, cancelled: 0, withdrawn: 0, problems: [], noChannel: [] });

class OutOfCalls extends Error {}

/** Groups rows by a key in one pass. */
function groupBy<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Slack user ids of members, by email lookup (cached) or as an admin picked them. */
async function slackUsersFor(api: SlackApi, people: { id: number; email: string }[], now: Date): Promise<Map<number, string | null>> {
  const ids = [...new Set(people.map((p) => p.id))];
  const known = ids.length ? await db.select().from(slackMembers).where(inArray(slackMembers.memberId, ids)) : [];
  const byId = new Map(known.map((k) => [k.memberId, k]));
  const result = new Map<number, string | null>();
  for (const p of people) {
    if (result.has(p.id)) continue;
    const row = byId.get(p.id);
    if (row && (row.slackUserId || row.manual || now.getTime() - row.checkedAt.getTime() < LOOKUP_AGAIN_MS)) {
      result.set(p.id, row.slackUserId);
      continue;
    }
    let slackUserId: string | null = null;
    try {
      const res = await api.call("users.lookupByEmail", { email: p.email });
      slackUserId = (res.user as { id?: string } | undefined)?.id ?? null;
    } catch (err) {
      if (!(err instanceof SlackError && err.code === "users_not_found")) throw err;
    }
    await db
      .insert(slackMembers)
      .values({ memberId: p.id, slackUserId, checkedAt: now })
      .onConflictDoUpdate({ target: slackMembers.memberId, set: { slackUserId, checkedAt: now } });
    result.set(p.id, slackUserId);
  }
  return result;
}

/** Calls Slack in `channel`; if the app is not in it, joins (public channels) and tries once more. */
async function inChannel<T>(api: SlackApi, channel: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof SlackError && err.code === "not_in_channel")) throw err;
    try {
      await api.call("conversations.join", { channel });
    } catch {
      throw err; // could not join (private channel, or no channels:join scope): report not_in_channel
    }
    return fn();
  }
}

/** One run without the lease. App code calls runSlackSync(). */
export async function syncSlackAnnouncements({
  api: slack = slackClient(),
  now = new Date(),
  scanLeftovers = false,
  maxCalls = CALLS_PER_RUN,
}: { api?: SlackApi | null; now?: Date; scanLeftovers?: boolean; maxCalls?: number } = {}): Promise<SlackSyncReport> {
  const report = emptyReport();
  if (!slack) return { ...report, ok: false, error: "Slack is not set up (SLACK_BOT_TOKEN)." };
  let left = maxCalls;
  const api: SlackApi = {
    async call(method, params) {
      if (left-- <= 0) throw new OutOfCalls();
      try {
        return await slack.call(method, params);
      } catch (err) {
        // Slack asks to slow down: stop here, the next run carries on.
        if (err instanceof SlackError && err.code.startsWith("ratelimited")) throw new OutOfCalls();
        throw err;
      }
    },
  };
  try {
    await syncWith(api, report, now, scanLeftovers);
  } catch (err) {
    if (!(err instanceof OutOfCalls)) throw err;
    report.more = true;
  }
  if (report.problems.length && !report.error) report.ok = false;
  return report;
}

/** Takes back the queued messages of deleted meetings, soonest post first. */
async function processWithdrawals(api: SlackApi, report: SlackSyncReport) {
  const queue = await db.select().from(slackWithdrawals).orderBy(sql`${slackWithdrawals.postAt} asc nulls last`, asc(slackWithdrawals.id));
  for (const w of queue) {
    try {
      if (w.scheduledMessageId) await api.call("chat.deleteScheduledMessage", { channel: w.channelId, scheduled_message_id: w.scheduledMessageId });
      else if (w.messageTs) await api.call("chat.delete", { channel: w.channelId, ts: w.messageTs });
      report.withdrawn++;
    } catch (err) {
      if (err instanceof OutOfCalls) throw err;
      if (!(err instanceof SlackError && ALREADY_GONE.includes(err.code))) {
        const error = describeSlackError(err);
        report.problems.push({ meeting: "(taking back an announcement of a deleted meeting)", error });
        if (w.attempts + 1 < MAX_WITHDRAW_ATTEMPTS) {
          await db.update(slackWithdrawals).set({ attempts: w.attempts + 1, error }).where(eq(slackWithdrawals.id, w.id));
          continue;
        }
      }
    }
    await db.delete(slackWithdrawals).where(eq(slackWithdrawals.id, w.id));
  }
}

/** Scheduled messages of the app in Slack that belong to no scheduled announcement (meetings deleted directly). */
async function withdrawLeftovers(api: SlackApi, known: Set<string>, report: SlackSyncReport) {
  let cursor: string | undefined;
  const leftovers: { id: string; channel: string; postAt: number }[] = [];
  for (let page = 0; page < 20; page++) {
    const res = await api.call("chat.scheduledMessages.list", { limit: 100, cursor });
    for (const m of (res.scheduled_messages as { id: string; channel_id: string; post_at: number }[]) ?? []) {
      if (!known.has(m.id)) leftovers.push({ id: m.id, channel: m.channel_id, postAt: m.post_at });
    }
    cursor = (res.response_metadata as { next_cursor?: string } | undefined)?.next_cursor || undefined;
    if (!cursor) break;
  }
  for (const o of leftovers.sort((a, b) => a.postAt - b.postAt)) {
    try {
      await api.call("chat.deleteScheduledMessage", { channel: o.channel, scheduled_message_id: o.id });
    } catch (err) {
      if (!(err instanceof SlackError && ALREADY_GONE.includes(err.code))) throw err;
    }
    report.withdrawn++;
  }
  report.scanned = true;
}

async function syncWith(api: SlackApi, report: SlackSyncReport, now: Date, scanLeftovers: boolean): Promise<void> {
  // First take back what belongs to deleted meetings, so none of it gets posted.
  await processWithdrawals(api, report);

  const channels = new Map((await db.select().from(slackChannels)).map((c) => [c.series, c.channelId]));
  const longest = Math.max(...ANNOUNCEMENT_KINDS.map((k) => k.minutes)) * 60_000;
  // Meetings that may need an announcement, plus those with one still scheduled (to cancel or reschedule).
  const pending = await db.select().from(slackAnnouncements).where(eq(slackAnnouncements.status, "scheduled"));
  if (scanLeftovers) {
    try {
      await withdrawLeftovers(api, new Set(pending.map((p) => p.scheduledMessageId).filter((id): id is string => !!id)), report);
    } catch (err) {
      if (err instanceof OutOfCalls) throw err;
      report.problems.push({ meeting: "(looking for leftover announcements in Slack)", error: describeSlackError(err) });
    }
  }
  const list = await db
    .select()
    .from(meetings)
    .where(
      or(
        and(gt(meetings.startsAt, now), lt(meetings.startsAt, new Date(now.getTime() + SLACK_SCHEDULE_MAX_DAYS * DAY + longest))),
        pending.length ? inArray(meetings.id, [...new Set(pending.map((p) => p.meetingId))]) : undefined,
      ),
    )
    // Soonest first: when a run stops at its call limit, the next announcements to go out are done.
    .orderBy(asc(meetings.startsAt));
  if (!list.length) return;
  const meetingIds = list.map((m) => m.id);
  const [rows, invitees] = await Promise.all([
    db.select().from(slackAnnouncements).where(inArray(slackAnnouncements.meetingId, meetingIds)),
    db
      .select({ meetingId: meetingInvites.meetingId, id: members.id, email: members.email })
      .from(meetingInvites)
      .innerJoin(members, and(eq(meetingInvites.memberId, members.id), eq(members.active, true)))
      .where(inArray(meetingInvites.meetingId, meetingIds)),
  ]);
  const rowsOf = groupBy(rows, (r) => r.meetingId);
  const inviteesOf = groupBy(invitees, (i) => i.meetingId);

  let slackIds: Map<number, string | null>;
  try {
    slackIds = await slackUsersFor(api, invitees, now);
  } catch (err) {
    if (err instanceof OutOfCalls) throw err;
    // Without users:read.email the announcements still go out, just without mentions.
    report.problems.push({ meeting: "(looking up members on Slack)", error: describeSlackError(err) });
    slackIds = new Map();
  }

  const save = async (meetingId: number, kind: AnnouncementKind, set: Partial<SlackAnnouncement> & { postAt: Date; status: SlackAnnouncement["status"] }) => {
    await db
      .insert(slackAnnouncements)
      .values({ meetingId, kind, ...set, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [slackAnnouncements.meetingId, slackAnnouncements.kind], set: { ...set, updatedAt: new Date() } });
  };

  for (const m of list) {
    const channelId = channels.get(m.series) ?? channels.get(DEFAULT_SERIES) ?? null;
    if (!channelId && m.status === "confirmed" && m.startsAt > now && !report.noChannel.includes(m.series)) report.noChannel.push(m.series);
    const people = inviteesOf.get(m.id) ?? [];
    const mine = rowsOf.get(m.id) ?? [];
    const mentions = people.map((p) => slackIds.get(p.id)).filter((id): id is string => !!id);
    const url = `${appUrl()}/meetings/${m.id}`;
    const textAt = (at: Date) => announcementText(m, mentions, people.length - mentions.length, url, at);
    const due: AnnouncementKind[] = [];

    try {
      for (const k of ANNOUNCEMENT_KINDS) {
        const existing = mine.find((r) => r.kind === k.kind) ?? null;
        const postAt = new Date(m.startsAt.getTime() - k.minutes * 60_000);
        const text = textAt(postAt);
        const wanted = channelId ? { channelId, hash: contentHash(channelId, text) } : null;
        const action = decideAnnouncement({ startsAt: m.startsAt, confirmed: m.status === "confirmed" }, k.minutes, existing, wanted, now);
        if (action.type === "none") continue;
        if (action.type === "mark_posted") {
          await save(m.id, k.kind, { status: "posted", postAt: existing!.postAt, scheduledMessageId: null });
          continue;
        }
        if ((action.type === "cancel" || ("replace" in action && action.replace)) && existing?.scheduledMessageId && existing.channelId) {
          try {
            await api.call("chat.deleteScheduledMessage", { channel: existing.channelId, scheduled_message_id: existing.scheduledMessageId });
          } catch (err) {
            // Already gone (posted or deleted in Slack) is fine; anything else is reported.
            if (!(err instanceof SlackError && err.code === "invalid_scheduled_message_id")) throw err;
          }
        }
        if (action.type === "cancel") {
          await save(m.id, k.kind, { status: "cancelled", postAt: existing!.postAt, scheduledMessageId: null });
          report.cancelled++;
        } else if (action.type === "schedule") {
          const res = await inChannel(api, wanted!.channelId, () =>
            api.call("chat.scheduleMessage", { channel: wanted!.channelId, post_at: Math.floor(postAt.getTime() / 1000), text, unfurl_links: false }),
          );
          await save(m.id, k.kind, {
            status: "scheduled",
            postAt,
            channelId: wanted!.channelId,
            contentHash: wanted!.hash,
            scheduledMessageId: String(res.scheduled_message_id),
            error: null,
          });
          if (action.replace) report.rescheduled++;
          else report.scheduled++;
        } else {
          due.push(k.kind);
        }
      }
      // Announcements whose moment has passed go out now, as one message per meeting.
      if (due.length && channelId) {
        const res = await inChannel(api, channelId, () => api.call("chat.postMessage", { channel: channelId, text: textAt(now), unfurl_links: false }));
        for (const kind of due) {
          await save(m.id, kind, { status: "posted", postAt: now, channelId, messageTs: String(res.ts), scheduledMessageId: null, error: null });
        }
        report.postedNow++;
      }
    } catch (err) {
      if (err instanceof OutOfCalls) throw err; // the next run carries on
      const error = describeSlackError(err);
      report.problems.push({ meeting: `${m.title} (${m.startsAt.toISOString().slice(0, 10)})`, error });
      // Remember the failure on the announcements that are not done, so admins see it; the next run retries.
      for (const k of ANNOUNCEMENT_KINDS) {
        const existing = mine.find((r) => r.kind === k.kind);
        if (existing?.status === "posted" || m.status !== "confirmed" || m.startsAt <= now) continue;
        const postAt = new Date(m.startsAt.getTime() - k.minutes * 60_000);
        if (existing?.status === "scheduled") await db.update(slackAnnouncements).set({ error }).where(eq(slackAnnouncements.id, existing.id));
        else await save(m.id, k.kind, { status: "failed", postAt, channelId, error });
      }
      if (err instanceof SlackError && ["invalid_auth", "not_authed", "account_inactive", "token_revoked"].includes(err.code)) {
        report.ok = false;
        report.error = error;
        return;
      }
    }
  }
}

/**
 * Runs unless one is already running or (without `force`) the last one finished less than 5 minutes
 * ago. Never throws; the outcome is kept in sync_state (shown on Admin → Slack).
 */
export async function runSlackSync({ force = false, api, now }: { force?: boolean; api?: SlackApi | null; now?: Date } = {}): Promise<SlackSyncReport | null> {
  if (!(api ?? slackClient())) return null;
  if (!(await acquireSync(SLACK_SYNC, { minIntervalSeconds: SLACK_SYNC_SECONDS, force }))) return null;
  let report: SlackSyncReport;
  try {
    const lastScan = await getSyncState(SLACK_LEFTOVERS);
    const scanLeftovers = force || !lastScan?.lastFinishedAt || Date.now() - lastScan.lastFinishedAt.getTime() > LEFTOVER_SCAN_MS;
    report = await syncSlackAnnouncements({ api, now, scanLeftovers });
    if (report.scanned) await recordSyncResult(SLACK_LEFTOVERS, { ok: true });
  } catch (err) {
    report = { ...emptyReport(), ok: false, error: describeSlackError(err) };
  }
  const summary = report.error ?? report.problems.map((p) => `${p.meeting}: ${p.error}`).join("; ");
  await finishSync(SLACK_SYNC, { ok: report.ok, error: summary || null });
  if (!report.ok) console.error("[slack]", summary);
  return report;
}

/** For after(): page loads. Never throws. */
export async function runSlackSyncQuietly(): Promise<void> {
  try {
    await runSlackSync();
  } catch (err) {
    console.error("[slack]", (err as Error).message);
  }
}
