// Building blocks shared by the member hours page, the dashboard and the admin hours pages.
import Link from "next/link";
import type { TimeEntry } from "@/db/schema";
import { locationLabel, type LocationTotals } from "@/lib/hours/location";
import {
  canEditEntry,
  formatDay,
  formatDuration,
  formatHours,
  formatWeek,
  fromFirstWeekWithHours,
  ljubljanaParts,
  type Pace,
} from "@/lib/hours/time";

/** "Office 12 h · Home 3 h", plus unspecified (entries from before locations were recorded) when there is some; only that when nothing has a location. */
export function LocationSplit({ totals, className = "" }: { totals: LocationTotals; className?: string }) {
  const known = totals.office + totals.home > 0;
  const parts: [string, number][] = known
    ? [
        ["Office", totals.office],
        ["Home", totals.home],
      ]
    : [];
  if (totals.unspecified > 0) parts.push([known ? "Unspecified" : "Location unspecified", totals.unspecified]);
  return (
    <span className={`tabular-nums ${className}`} data-testid="location-split">
      {parts.map(([label, ms]) => `${label} ${formatHours(ms)} h`).join(" · ")}
    </span>
  );
}

export function WeekProgress({
  totalMs,
  targetHours,
  label = "This week",
  byLocation,
}: {
  totalMs: number;
  targetHours: number;
  label?: string;
  byLocation?: LocationTotals;
}) {
  const pct = targetHours > 0 ? Math.min(100, Math.round((totalMs / 3_600_000 / targetHours) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5" data-testid="week-progress">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <strong className="text-base">{formatHours(totalMs)}</strong> / {targetHours} h <span className="text-subtle">· {pct}%</span>
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${pct}% of ${targetHours} hours`}
      >
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-success-solid" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      {byLocation && totalMs > 0 && <LocationSplit totals={byLocation} className="text-xs text-muted" />}
    </div>
  );
}

const PACE: Record<Pace, { label: string; className: string }> = {
  met: { label: "Target met", className: "bg-success-bg text-success ring-success-line" },
  on_track: { label: "On track", className: "bg-surface-3 text-fg-2 ring-line" },
  behind: { label: "Behind", className: "bg-danger-bg text-danger ring-danger-line" },
  below: { label: "Below target", className: "bg-warning-bg text-warning ring-warning-line" },
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
    return <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm text-subtle">No hours logged in this week.</p>;
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
          <li key={day} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            <div className="flex justify-between bg-surface-2 px-4 py-2 text-sm">
              <span className="font-semibold">{formatDay(day)}</span>
              <span className="tabular-nums text-muted">{formatDuration(dayMs)}</span>
            </div>
            <ul className="divide-y divide-line">
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
    locationLabel(e.location),
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
              {nextDay && <span className="text-subtle"> (next day)</span>}
            </>
          ) : (
            <span className="font-medium text-success">now</span>
          )}
        </span>
        <span className="text-xs text-subtle">{notes.join(" · ")}</span>
      </span>
      <span className={`tabular-nums ${e.endedAt ? "" : "text-success"}`}>{formatDuration((e.endedAt ?? now).getTime() - e.startedAt.getTime())}</span>
      {editable && (
        <Link
          href={`/hours/entries/${e.id}?returnTo=${encodeURIComponent(returnTo)}`}
          className="rounded-lg px-2 py-1 text-xs font-medium text-muted ring-1 ring-line hover:bg-surface-2"
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
  weeks: { week: string; totalMs: number; byLocation?: LocationTotals }[];
  targetHours: number;
  selected: string;
  hrefFor: (week: string) => string;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm" data-testid="week-history">
      {fromFirstWeekWithHours(weeks).map(({ week, totalMs, byLocation }) => {
        const pct = targetHours > 0 ? Math.round((totalMs / 3_600_000 / targetHours) * 100) : 0;
        return (
          <li key={week}>
            <Link
              href={hrefFor(week)}
              aria-current={week === selected ? "true" : undefined}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2 ${week === selected ? "bg-surface-2 font-semibold" : ""}`}
            >
              <span>{formatWeek(week)}</span>
              <span className="flex flex-col items-end">
                <span className="tabular-nums">
                  {formatHours(totalMs)} / {targetHours} h{" "}
                  <span className={pct >= 100 ? "text-success" : pct < 50 ? "text-danger" : "text-subtle"}>({pct}%)</span>
                </span>
                {byLocation && totalMs > 0 && <LocationSplit totals={byLocation} className="text-xs font-normal text-subtle" />}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
