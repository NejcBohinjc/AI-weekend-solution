import Link from "next/link";
import { meetingWhen, SeriesBadge } from "@/components/meetings";
import { TIMEZONE } from "@/lib/app";
import { requireAdmin } from "@/lib/auth";
import { emailSettings } from "@/lib/email";
import { calendarUrl } from "@/lib/meetings/import";
import { attendanceBySeries, lastMeetingImport, meetingsWithCounts, recentEmails } from "@/lib/meetings/queries";
import { attendanceSummary, meetingPhase } from "@/lib/meetings/rules";
import { ImportPanel } from "./import-panel";
import { RemindersPanel } from "./reminders-panel";

type Search = { view?: string; series?: string };

export default async function AdminMeetingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = sp.view === "past" ? "past" : "upcoming";
  const now = new Date();
  const [all, last, emails, bySeries] = await Promise.all([meetingsWithCounts(now), lastMeetingImport(), recentEmails(), attendanceBySeries(now)]);
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
        <p className="text-sm text-slate-600">
          {all.length} meetings in {seriesList.length} series · open a meeting to record attendance
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ImportPanel last={last?.report ?? null} lastBy={last?.by ?? null} hasUrl={Boolean(calendarUrl())} />
        <RemindersPanel sending={mail.sending} from={mail.from} redirectTo={mail.redirectTo}>
          {emails.length > 0 && (
            <ul className="divide-y divide-slate-100 text-xs" data-testid="email-log">
              {emails.map((e) => (
                <li key={e.id} className="flex gap-2 py-1.5">
                  <span className="shrink-0 tabular-nums text-slate-500">{fmt(e.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate" title={e.error ?? undefined}>
                    {e.to}: {e.subject}
                  </span>
                  <span className={e.status === "sent" ? "text-emerald-700" : e.status === "failed" ? "text-red-700" : "text-slate-500"}>
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
          <nav aria-label="When" className="flex rounded-xl bg-slate-100 p-1 font-medium">
            {(["upcoming", "past"] as const).map((v) => (
              <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined} className={`rounded-lg px-3 py-1.5 ${view === v ? "bg-white shadow-sm" : "text-slate-600"}`}>
                {v === "upcoming" ? "Upcoming" : "Past"}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1 overflow-x-auto">
            <Link href={href({ series: "" })} className={`shrink-0 rounded-full px-3 py-1 ${!series ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}>
              All series
            </Link>
            {seriesList.map((s) => (
              <Link key={s} href={href({ series: s })} className={`shrink-0 rounded-full px-3 py-1 ${series === s ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`}>
                {s}
              </Link>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="admin-meetings">
          {shown.map(({ meeting: m, counts: c }) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`} className={`flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3 ${m.status !== "confirmed" ? "opacity-60" : ""}`}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">
                    {m.title} {m.status === "cancelled" && <span className="text-xs font-normal text-slate-500">(cancelled)</span>}
                  </span>
                  <span className="text-sm text-slate-600">{meetingWhen(m)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <SeriesBadge series={m.series} />
                  <span className="tabular-nums text-slate-600">
                    {view === "past"
                      ? `${c.present} present · ${c.remote} remote · ${c.excused} excused · ${c.unexcused} unexcused`
                      : `${c.invited} invited · ${c.excused} excused${c.present + c.remote ? ` · ${c.present + c.remote} checked in` : ""}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {!shown.length && <li className="px-4 py-6 text-center text-sm text-slate-500">No meetings here.</li>}
        </ul>
      </div>

      {people.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Attendance by member and series</h2>
          <p className="text-xs text-slate-500">Attended (present or remote) out of meetings that are over. Red is under 50%.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm" data-testid="attendance-matrix">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
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
              <tbody className="divide-y divide-slate-100">
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
                        <td key={s ?? "all"} className={`px-3 py-1.5 tabular-nums ${c.rate === null ? "text-slate-300" : c.rate < 50 ? "font-medium text-red-700" : ""} ${s ? "" : "font-semibold"}`}>
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
