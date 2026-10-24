// Building blocks shared by the member hours page, the dashboard and the admin hours pages.
import Link from "next/link";
import type { TimeEntry } from "@/db/schema";
import { canEditEntry, formatDuration, formatHours, formatDay, formatWeek, ljubljanaParts, type Pace } from "@/lib/hours/time";

export function WeekProgress({ totalMs, targetHours, label = "This week" }: { totalMs: number; targetHours: number; label?: string }) {
  const pct = targetHours > 0 ? Math.min(100, Math.round((totalMs / 3_600_000 / targetHours) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5" data-testid="week-progress">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <strong className="text-base">{formatHours(totalMs)}</strong> / {targetHours} h <span className="text-slate-500">· {pct}%</span>
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${pct}% of ${targetHours} hours`}
      >
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-slate-900"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const PACE: Record<Pace, { label: string; className: string }> = {
  met: { label: "Target met", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  on_track: { label: "On track", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  behind: { label: "Behind", className: "bg-red-50 text-red-700 ring-red-200" },
  below: { label: "Below target", className: "bg-amber-50 text-amber-800 ring-amber-200" },
};

export function PaceBadge({ pace }: { pace: Pace }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${PACE[pace].className}`}>{PACE[pace].label}</span>;
}

type Viewer = { id: number; isAdmin: boolean };

/** A week's entries grouped by the day they started, newest first. */
export function EntryList({
  entries,
  viewer,
  thisWeekStart,
  returnTo,
  now,
}: {
  entries: TimeEntry[];
  viewer: Viewer;
  thisWeekStart: Date;
  returnTo: string;
  now: Date;
}) {
  if (!entries.length) {
    return <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">No hours logged in this week.</p>;
  }
  const days = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const day = ljubljanaParts(e.startedAt).date;
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  return (
    <ul className="flex flex-col gap-3" data-testid="entry-list">
      {[...days].map(([day, list]) => {
        const dayMs = list.reduce((s, e) => s + ((e.endedAt ?? now).getTime() - e.startedAt.getTime()), 0);
        return (
          <li key={day} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex justify-between bg-slate-50 px-4 py-2 text-sm">
              <span className="font-semibold">{formatDay(day)}</span>
              <span className="tabular-nums text-slate-600">{formatDuration(dayMs)}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((e) => (
                <EntryRow key={e.id} entry={e} viewer={viewer} editable={canEditEntry(viewer, e, thisWeekStart)} returnTo={returnTo} now={now} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function EntryRow({ entry: e, viewer, editable, returnTo, now }: { entry: TimeEntry; viewer: Viewer; editable: boolean; returnTo: string; now: Date }) {
  const start = ljubljanaParts(e.startedAt);
  const end = e.endedAt ? ljubljanaParts(e.endedAt) : null;
  const nextDay = end && end.date !== start.date;
  const notes = [
    e.source === "manual" && "added by hand",
    e.source === "seed" && "imported",
    e.editedById && "changed by an admin",
    e.endedAt && e.sheetStatus === "pending" && (viewer.isAdmin && e.sheetError ? "not synced to the sheet (error)" : "not synced to the sheet"),
  ].filter(Boolean);

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="tabular-nums">
          {start.time} –{" "}
          {end ? (
            <>
              {end.time}
              {nextDay && <span className="text-slate-500"> (next day)</span>}
            </>
          ) : (
            <span className="font-medium text-emerald-700">now</span>
          )}
        </span>
        {notes.length > 0 && <span className="text-xs text-slate-500">{notes.join(" · ")}</span>}
      </span>
      <span className={`tabular-nums ${e.endedAt ? "" : "text-emerald-700"}`}>{formatDuration((e.endedAt ?? now).getTime() - e.startedAt.getTime())}</span>
      {editable && (
        <Link
          href={`/hours/entries/${e.id}?returnTo=${encodeURIComponent(returnTo)}`}
          className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Edit
        </Link>
      )}
    </li>
  );
}

/** Totals of recent weeks; the selected week is highlighted. */
export function WeekHistory({
  weeks,
  targetHours,
  selected,
  hrefFor,
}: {
  weeks: { week: string; totalMs: number }[];
  targetHours: number;
  selected: string;
  hrefFor: (week: string) => string;
}) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="week-history">
      {weeks.map(({ week, totalMs }) => {
        const pct = targetHours > 0 ? Math.round((totalMs / 3_600_000 / targetHours) * 100) : 0;
        return (
          <li key={week}>
            <Link
              href={hrefFor(week)}
              aria-current={week === selected ? "true" : undefined}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 ${week === selected ? "bg-slate-50 font-semibold" : ""}`}
            >
              <span>{formatWeek(week)}</span>
              <span className="tabular-nums">
                {formatHours(totalMs)} / {targetHours} h{" "}
                <span className={pct >= 100 ? "text-emerald-700" : pct < 50 ? "text-red-700" : "text-slate-500"}>({pct}%)</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
