import Link from "next/link";
import { meetingWhen, SeriesBadge } from "@/components/meetings";
import { ABSENCE_NOTICE_HOURS } from "@/lib/absence-rules";
import { TIMEZONE } from "@/lib/app";
import { requireAdmin } from "@/lib/auth";
import { emailSettings } from "@/lib/email";
import { syncCalendarInBackground } from "@/lib/meetings/auto-sync";
import { CALENDAR_SYNC_MINUTES, calendarUrl, lastCalendarSync } from "@/lib/meetings/import";
import { attendanceBySeries, lastMeetingImport, meetingsWithCounts, pendingLateNotices, recentEmails } from "@/lib/meetings/queries";
import { attendanceSummary, meetingPhase } from "@/lib/meetings/rules";
import { ImportPanel } from "./import-panel";
import { RemindersPanel } from "./reminders-panel";

type Search = { view?: string; series?: string };

export default async function AdminMeetingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const view = sp.view === "past" ? "past" : "upcoming";
  const now = new Date();
  // The queries do not depend on who is asking, so they run while the session is being checked; if the
  // member is not an admin, requireAdmin() redirects and their results are never used.
  const [, all, last, emails, bySeries, lastPull, lateNotices] = await Promise.all([
    requireAdmin(),
    meetingsWithCounts(now),
    lastMeetingImport(),
    recentEmails(),
    attendanceBySeries(now),
    lastCalendarSync(),
    pendingLateNotices(),
  ]);
  syncCalendarInBackground();
  const auto = calendarUrl()
    ? { minutes: CALENDAR_SYNC_MINUTES, last: lastPull && { at: lastPull.at.toISOString(), ok: lastPull.ok, error: lastPull.error } }
    : null;
  const seriesList = [...new Set(all.map((m) => m.meeting.series))].sort();
  const series = sp.series && seriesList.includes(sp.series) ? sp.series : undefined;
  const shown = all
    .filter((m) => (view === "past" ? meetingPhase(m.meeting, now) === "past" : meetingPhase(m.meeting, now) !== "past"))
    .filter((m) => !series || m.meeting.series === series);
  if (view === "past") shown.reverse();
  const href = (patch: Search) => {
    const params = new URLSearchParams(Object.entries({ view, series, ...patch }).filter(([, v]) => v) as [string, string][]);
    if (params.get("view") === "upcoming") params.delete("view");
    const qs = params.toString();
    return qs ? `/admin/meetings?${qs}` : "/admin/meetings";
  };
  const mail = emailSettings();
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: TIMEZONE });

  // Member x series table of meetings that are over.
  const people = [...new Map(bySeries.map((r) => [r.memberId, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cell = (memberId: number, s?: string) =>
    attendanceSummary(bySeries.filter((r) => r.memberId === memberId && (!s || r.series === s)).map((r) => r.state));

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
        <p className="text-sm text-muted">
          {all.length} meetings in {seriesList.length} series · open a meeting to record attendance
        </p>
      </div>

      {lateNotices.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-warning-line bg-warning-bg p-4" data-testid="late-notices">
          <h2 className="font-semibold text-warning">Late notices to decide ({lateNotices.length})</h2>
          <p className="text-sm text-fg-2">
            Excuses sent less than {ABSENCE_NOTICE_HOURS} h before the start. They count as unexcused until you accept them on the meeting page.
          </p>
          <ul className="divide-y divide-warning-line text-sm">
            {lateNotices.map((n) => (
              <li key={`${n.meetingId}:${n.memberId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{n.name}</span> · {n.note ? `“${n.note}”` : "no reason"}
                </span>
                <Link href={`/meetings/${n.meetingId}`} className="font-medium text-link underline underline-offset-2">
                  {n.title}, {n.startsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TIMEZONE })} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ImportPanel last={last?.report ?? null} lastBy={last?.by ?? null} auto={auto} />
        <RemindersPanel sending={mail.sending} from={mail.from} redirectTo={mail.redirectTo}>
          {emails.length > 0 && (
            <ul className="divide-y divide-line text-xs" data-testid="email-log">
              {emails.map((e) => (
                <li key={e.id} className="flex gap-2 py-1.5">
                  <span className="shrink-0 tabular-nums text-subtle">{fmt(e.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate" title={e.error ?? undefined}>
                    {e.to}: {e.subject}
                  </span>
                  <span className={e.status === "sent" ? "text-success" : e.status === "failed" ? "text-danger" : "text-subtle"}>
                    {e.status === "logged" ? "not sent" : e.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </RemindersPanel>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <nav aria-label="When" className="flex rounded-xl bg-surface-3 p-1 font-medium">
            {(["upcoming", "past"] as const).map((v) => (
              <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined} className={`rounded-lg px-3 py-1.5 ${view === v ? "bg-surface shadow-sm" : "text-muted"}`}>
                {v === "upcoming" ? "Upcoming" : "Past"}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1 overflow-x-auto">
            <Link href={href({ series: "" })} className={`shrink-0 rounded-full px-3 py-1 ${!series ? "bg-primary text-on-primary" : "bg-surface ring-1 ring-line"}`}>
              All series
            </Link>
            {seriesList.map((s) => (
              <Link key={s} href={href({ series: s })} className={`shrink-0 rounded-full px-3 py-1 ${series === s ? "bg-primary text-on-primary" : "bg-surface ring-1 ring-line"}`}>
                {s}
              </Link>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm" data-testid="admin-meetings">
          {shown.map(({ meeting: m, counts: c }) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`} className={`flex flex-col gap-1 px-4 py-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-3 ${m.status !== "confirmed" ? "opacity-60" : ""}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">
                    {m.title} {m.status === "cancelled" && <span className="text-xs font-normal text-subtle">(cancelled)</span>}
                  </span>
                  <span className="text-sm text-muted">{meetingWhen(m)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <SeriesBadge series={m.series} />
                  <span className="tabular-nums text-muted">
                    {view === "past"
                      ? `${c.present} present · ${c.remote} remote · ${c.excused} excused · ${c.unexcused} unexcused`
                      : `${c.invited} invited · ${c.excused} excused${c.present + c.remote ? ` · ${c.present + c.remote} checked in` : ""}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {!shown.length && <li className="px-4 py-6 text-center text-sm text-subtle">No meetings here.</li>}
        </ul>
      </div>

      {people.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Attendance by member and series</h2>
          <p className="text-xs text-subtle">Attended (present or remote) out of meetings that are over. Red is under 50%.</p>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm" data-testid="attendance-matrix">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Member</th>
                  {seriesList.map((s) => (
                    <th key={s} className="px-3 py-2 font-semibold whitespace-nowrap">
                      {s}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-semibold">All</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map(([memberId, name]) => (
                  <tr key={memberId}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Link href={`/admin/members/${memberId}`} className="hover:underline">
                        {name}
                      </Link>
                    </td>
                    {[...seriesList, undefined].map((s) => {
                      const c = cell(memberId, s);
                      return (
                        <td key={s ?? "all"} className={`px-3 py-1.5 tabular-nums ${c.rate === null ? "text-subtle" : c.rate < 50 ? "font-medium text-danger" : ""} ${s ? "" : "font-semibold"}`}>
                          {c.total ? `${c.attended}/${c.total}` : "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
