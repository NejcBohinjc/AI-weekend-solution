import { and, asc, eq, gte, lte } from "drizzle-orm";
import Link from "next/link";
import { inputClass } from "@/components/ui";
import { db } from "@/db";
import { meetings, members, slackAnnouncements, slackChannels, slackMembers } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireAdmin } from "@/lib/auth";
import { SLACK_SYNC } from "@/lib/slack/announcements";
import { slackClient } from "@/lib/slack/client";
import { ANNOUNCEMENT_KINDS, DEFAULT_SERIES } from "@/lib/slack/constants";
import { workspaceInfo } from "@/lib/slack/workspace";
import { activeSeries } from "@/lib/meetings/series";
import { getSyncState } from "@/lib/sync-state";
import { saveChannelsAction, savePeopleAction, syncSlackNowAction } from "./actions";
import { SlackForm } from "./slack-forms";

const SCOPES = ["chat:write", "channels:read", "channels:join", "users:read", "users:read.email"];
const KIND_LABEL = Object.fromEntries(ANNOUNCEMENT_KINDS.map((k) => [k.kind, k.label]));
const STATUS_STYLE: Record<string, string> = {
  scheduled: "text-muted",
  posted: "text-success",
  cancelled: "text-subtle line-through",
  failed: "text-danger font-medium",
};

export default async function AdminSlackPage() {
  await requireAdmin();
  const api = slackClient();
  const fmt = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });

  if (!api) {
    return (
      <section className="flex max-w-3xl flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-display">Slack</h1>
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-card text-sm text-fg-2">
          <p className="font-semibold text-fg">Slack is not connected (optional).</p>
          <p>With Slack connected, every meeting is announced in its series&apos; channel 3 days and 1 day before, mentioning the people invited. The rest of the app writes nothing to Slack.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              At api.slack.com/apps: <em>Create New App</em> → <em>From scratch</em>, pick your workspace.
            </li>
            <li>
              <em>OAuth &amp; Permissions</em> → Bot Token Scopes: {SCOPES.map((s) => <span key={s}><code className="rounded bg-surface-3 px-1">{s}</code>{" "}</span>)}
            </li>
            <li>
              <em>Install to Workspace</em>, copy the <em>Bot User OAuth Token</em> (xoxb-…) into <code className="rounded bg-surface-3 px-1">SLACK_BOT_TOKEN</code> and redeploy.
            </li>
          </ol>
        </div>
      </section>
    );
  }

  const now = new Date();
  const [info, channelRows, seriesRows, people, links, upcoming, state] = await Promise.all([
    workspaceInfo(api),
    db.select().from(slackChannels),
    activeSeries(),
    db.select({ id: members.id, name: members.name, email: members.email }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
    db.select().from(slackMembers),
    db
      .select({ a: slackAnnouncements, title: meetings.title, series: meetings.series, startsAt: meetings.startsAt, meetingId: meetings.id })
      .from(slackAnnouncements)
      .innerJoin(meetings, eq(slackAnnouncements.meetingId, meetings.id))
      .where(and(gte(meetings.startsAt, new Date(now.getTime() - 2 * 86_400_000)), lte(slackAnnouncements.postAt, new Date(now.getTime() + 14 * 86_400_000))))
      .orderBy(asc(slackAnnouncements.postAt)),
    getSyncState(SLACK_SYNC),
  ]);
  const channelOf = new Map(channelRows.map((c) => [c.series, c]));
  const linkOf = new Map(links.map((l) => [l.memberId, l]));
  const userName = new Map(info.users.map((u) => [u.id, u.name]));
  // Series with active meetings, plus any that still has a channel set (so it can be cleared).
  const seriesList = [...new Set([...seriesRows, ...channelRows.map((c) => c.series).filter((s) => s !== DEFAULT_SERIES)])].sort().concat(DEFAULT_SERIES);
  const matched = people.filter((p) => linkOf.get(p.id)?.slackUserId).length;

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-display">Slack</h1>
        <p className="text-sm text-muted">
          {info.team ? (
            <>
              Connected to <strong>{info.team}</strong> as <strong>@{info.bot}</strong>.{" "}
            </>
          ) : null}
          Every meeting is announced in its channel 3 days and 1 day before (Slack posts them at that time), mentioning the people invited. Only admins see this page.
        </p>
      </div>
      {info.errors.map((e) => (
        <p key={e} role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
          {e}
        </p>
      ))}

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-semibold">Channels</h2>
        <p className="text-xs text-subtle">
          A series without a channel uses the default. The app joins public channels by itself; for a private channel, type <code>/invite @{info.bot ?? "app"}</code> in it.
        </p>
        <SlackForm action={saveChannelsAction} submitLabel="Save channels and sync" label="Channels per meeting series">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {seriesList.map((series) => {
              const current = channelOf.get(series);
              const known = info.channels.some((c) => c.id === current?.channelId);
              return (
                <label key={series} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{series === DEFAULT_SERIES ? "Default (all other series)" : series}</span>
                  <select name={`channel:${series}`} defaultValue={current ? `${current.channelId}|${current.channelName ?? ""}` : ""} className={`${inputClass} py-2`}>
                    <option value="">{series === DEFAULT_SERIES ? "No default: not announced" : "Use the default"}</option>
                    {current && !known && <option value={`${current.channelId}|${current.channelName ?? ""}`}>#{current.channelName ?? current.channelId}</option>}
                    {info.channels.map((c) => (
                      <option key={c.id} value={`${c.id}|${c.name}`}>
                        #{c.name}
                        {c.isMember ? "" : " (app joins it)"}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </SlackForm>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Announcements in the next 14 days</h2>
          <span className="text-xs text-subtle">
            {state?.lastFinishedAt ? `Last sync ${fmt(state.lastFinishedAt)}${state.lastOk === false ? " (with problems)" : ""}` : "Not synced yet"} · syncs on its own with the calendar
          </span>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-subtle">Nothing yet. Choose channels above, then sync.</p>
        ) : (
          <ul className="divide-y divide-line text-sm" data-testid="slack-announcements">
            {upcoming.map(({ a, title, series, meetingId }) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="w-36 shrink-0 tabular-nums text-muted">{fmt(a.postAt)}</span>
                <span className="min-w-0 flex-1">
                  <Link href={`/meetings/${meetingId}`} className="font-medium hover:underline">
                    {title}
                  </Link>{" "}
                  <span className="text-xs text-subtle">
                    {series} · {KIND_LABEL[a.kind]}
                    {a.channelId && ` · #${channelRows.find((c) => c.channelId === a.channelId)?.channelName ?? a.channelId}`}
                  </span>
                  {a.error && <span className="block text-xs text-danger">{a.error}</span>}
                </span>
                <span className={`text-xs ${STATUS_STYLE[a.status]}`}>{a.status}</span>
              </li>
            ))}
          </ul>
        )}
        {state?.lastOk === false && state.lastError && <p className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">{state.lastError}</p>}
        <SlackForm action={syncSlackNowAction} submitLabel="Sync with Slack now" label="Sync with Slack" />
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-semibold">People on Slack</h2>
        <p className="text-xs text-subtle">
          {matched} of {people.length} members are linked to a Slack account, so announcements mention them. Members are found by their email; pick the account by hand when it differs.
        </p>
        <SlackForm action={savePeopleAction} submitLabel="Save and update announcements" label="Members' Slack accounts">
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {people.map((p) => {
              const link = linkOf.get(p.id);
              const value = !link || !link.manual ? "auto" : (link.slackUserId ?? "none");
              const found = link && !link.manual ? (link.slackUserId ? `found: ${userName.get(link.slackUserId) ?? link.slackUserId}` : "not found by email") : null;
              return (
                <label key={p.id} className="flex flex-col gap-1 text-sm">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{p.name}</span>
                    {found && <span className={`text-xs ${link?.slackUserId ? "text-success" : "text-subtle"}`}>{found}</span>}
                  </span>
                  <select name={`slack:${p.id}`} defaultValue={value} className={`${inputClass} py-2`}>
                    <option value="auto">By email ({p.email})</option>
                    <option value="none">Not on Slack</option>
                    {info.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {u.email ? ` (${u.email})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </SlackForm>
      </div>
    </section>
  );
}
