import Link from "next/link";
import { TierBadge } from "@/components/badges";
import { PaceBadge } from "@/components/hours";
import { requireAdmin } from "@/lib/auth";
import { hoursSheetQueue, teamWeek } from "@/lib/hours/queries";
import { hoursSheetTab } from "@/lib/hours/sheet-sync";
import { addDays, formatHours, formatWeek, isWeekStart, weekBounds, weekPace, weekStartOf, type Pace } from "@/lib/hours/time";
import { SheetPanel } from "./sheet-panel";

// Most urgent first.
const PACE_ORDER: Record<Pace, number> = { behind: 0, below: 1, on_track: 2, met: 3 };

export default async function AdminHoursPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const now = new Date();
  const thisWeek = weekStartOf(now);
  const week = sp.week && isWeekStart(sp.week) && sp.week <= thisWeek ? sp.week : thisWeek;
  const isThisWeek = week === thisWeek;
  const { from, to } = weekBounds(week);
  const elapsed = isThisWeek ? (now.getTime() - from.getTime()) / (to.getTime() - from.getTime()) : 1;

  const [team, queue] = await Promise.all([teamWeek(week, now), hoursSheetQueue()]);
  const rows = team
    .map((m) => ({ ...m, pace: weekPace(m.totalMs, m.weeklyHours, elapsed), pct: Math.round((m.totalMs / 3_600_000 / m.weeklyHours) * 100) }))
    .sort((a, b) => PACE_ORDER[a.pace] - PACE_ORDER[b.pace] || a.pct - b.pct);
  const behind = rows.filter((r) => r.pace === "behind" || r.pace === "below").length;
  const working = rows.filter((r) => r.working);
  const weekHref = (w: string) => (w === thisWeek ? "/admin/hours" : `/admin/hours?week=${w}`);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hours</h1>
          <p className="text-sm text-slate-600">
            {isThisWeek ? "This week" : "Week of"} {formatWeek(week)} · {behind} {isThisWeek ? "behind" : "below target"} · {working.length} working now
          </p>
        </div>
        <nav aria-label="Week" className="flex items-center gap-1 text-sm">
          <Link href={weekHref(addDays(week, -7))} className="rounded-lg px-3 py-1.5 ring-1 ring-slate-200 hover:bg-slate-50">
            ← Previous
          </Link>
          {!isThisWeek && (
            <Link href={weekHref(addDays(week, 7))} className="rounded-lg px-3 py-1.5 ring-1 ring-slate-200 hover:bg-slate-50">
              Next →
            </Link>
          )}
        </nav>
      </div>

      <SheetPanel tab={hoursSheetTab()} pending={queue.pending} failed={queue.failed} lastError={queue.lastError} />

      {isThisWeek && (
        <p className="text-xs text-slate-500">
          “Behind” means under 75% of the hours expected by now ({Math.round(elapsed * 100)}% of the week has passed).
        </p>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="team-hours">
        {rows.map((m) => (
          <li key={m.id}>
            <Link
              href={`/admin/hours/${m.id}${isThisWeek ? "" : `?week=${week}`}`}
              className="flex flex-col gap-1.5 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">{m.name}</span>
                <TierBadge tier={m.tier} />
                {m.working && <span className="text-xs font-medium text-emerald-700">● working now</span>}
              </span>
              <span className="flex items-center gap-3">
                <span className="w-32 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <span className={`block h-2 rounded-full ${m.pct >= 100 ? "bg-emerald-500" : "bg-slate-900"}`} style={{ width: `${Math.min(100, m.pct)}%` }} />
                </span>
                <span className="w-24 text-right text-sm tabular-nums">
                  {formatHours(m.totalMs)} / {m.weeklyHours} h
                </span>
                <PaceBadge pace={m.pace} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
