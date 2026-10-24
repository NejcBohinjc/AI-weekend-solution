import Link from "next/link";
import { TierBadge } from "@/components/badges";
import { ChartCard, DataTable, HBarChart, Legend, LineChart, StackedBarChart } from "@/components/charts";
import { computeAnalytics, RANGES, type Range } from "@/lib/analytics/compute";
import { loadAnalyticsData } from "@/lib/analytics/load";
import { TIMEZONE } from "@/lib/app";
import { requireAdmin } from "@/lib/auth";
import { STATE_LABELS, type AttendanceState } from "@/lib/meetings/constants";
import { TIERS, type Tier } from "@/lib/tiers";
import { FilterBar } from "./filter-bar";

// Admin only: the middleware guards /admin/*, and the data is computed here on the server (no API).
export const dynamic = "force-dynamic";

// Colour follows the entity (fixed per tier / per series), never its rank.
const TIER_COLOR: Record<Tier, string> = { Core: "var(--viz-1)", Impact: "var(--viz-2)", "GO!": "var(--viz-3)" };
// Office / home / unspecified (entries from before the location was recorded: never guessed).
const LOCATION_PARTS = [
  { key: "office", label: "Office", color: "var(--viz-1)" },
  { key: "home", label: "Home", color: "var(--viz-2)" },
  { key: "unspecified", label: "Unspecified", color: "var(--viz-neutral)" },
] as const;
const STATE_STYLE: Record<AttendanceState, { bg: string; ink: string; letter: string }> = {
  present: { bg: "var(--viz-1)", ink: "var(--viz-cell-ink)", letter: "P" },
  remote: { bg: "var(--viz-3)", ink: "var(--viz-cell-ink)", letter: "R" },
  excused: { bg: "var(--viz-neutral)", ink: "var(--fg)", letter: "E" },
  unexcused: { bg: "var(--viz-2)", ink: "var(--viz-cell-ink)", letter: "U" },
};

const fmtWeek = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TIMEZONE });
const h1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-GB");

type Search = { tier?: string; series?: string; range?: string };

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tier = (TIERS as readonly string[]).includes(sp.tier ?? "") ? (sp.tier as Tier) : null;
  const range: Range = sp.range === "8w" || sp.range === "all" ? sp.range : "4w";
  const data = await loadAnalyticsData();
  const allSeries = [...new Set(data.meetings.filter((m) => m.status === "confirmed").map((m) => m.series))].sort();
  const series = allSeries.includes(sp.series ?? "") ? sp.series! : null;
  const view = computeAnalytics(data, { tier, series, range });

  const weekLabels = view.weeks.map(fmtWeek);
  const onTrack = view.hoursThisWeek.filter((h) => h.onTrack).length;
  const furthest = [...view.hoursThisWeek].sort((x, y) => x.pct - y.pct)[0];
  const lastFull = view.hoursByTier.at(-2);
  const thisWeekTotal = view.tiers.reduce((s, t) => s + (view.hoursByTier.at(-1)?.[t] ?? 0), 0);
  const locTotal = view.locationByTier.reduce((acc, r) => ({ office: acc.office + r.office, home: acc.home + r.home, unspecified: acc.unspecified + r.unspecified }), { office: 0, home: 0, unspecified: 0 });
  const locKnown = locTotal.office + locTotal.home;
  const bestSeries = view.attendanceBySeries[0];
  const worstSeries = view.attendanceBySeries.at(-1);
  const createdTotal = view.tasksPerWeek.reduce((s, w) => s + w.created + (w.aiCreated ?? 0), 0);
  const finishedTotal = view.tasksPerWeek.reduce((s, w) => s + w.finished, 0);
  const aiTotal = view.tasksPerWeek.reduce((s, w) => s + (w.aiCreated ?? 0), 0);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted">Who is active, who is drifting, and how the institute is doing. Admins only.</p>
      </div>

      <FilterBar
        filters={[
          { name: "tier", label: "Tier", value: tier ?? "", options: [{ value: "", label: "All tiers" }, ...TIERS.map((t) => ({ value: t, label: t }))] },
          { name: "series", label: "Meeting series", value: series ?? "", options: [{ value: "", label: "All series" }, ...allSeries.map((s) => ({ value: s, label: s }))] },
          { name: "range", label: "Date range", value: range, options: (Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: RANGES[r] })) },
        ]}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="tiles">
        <Tile label="Active this week" value={`${view.tiles.active.n} of ${view.tiles.active.of}`} note="logged hours, attended or worked on a task" />
        <Tile
          label="At their weekly target"
          value={view.tiles.atTarget.of ? `${Math.round((view.tiles.atTarget.n / view.tiles.atTarget.of) * 100)}%` : "–"}
          note={`${view.tiles.atTarget.n} of ${view.tiles.atTarget.of} on track (pro-rated to today)`}
        />
        <Tile
          label="Attendance, last 30 days"
          value={view.tiles.attendance30.rate === null ? "–" : `${view.tiles.attendance30.rate}%`}
          note={`${view.tiles.attendance30.attended} of ${view.tiles.attendance30.total} invitations attended${series ? ` · ${series}` : ""}`}
        />
        <Tile label="Tasks finished this week" value={String(view.tiles.finishedThisWeek)} note="unconfirmed AI tasks not counted" />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-warning-line bg-surface p-4" data-testid="drifting">
        <div>
          <h2 className="font-semibold">Drifting members ({view.drifting.length})</h2>
          <p className="text-sm text-muted">Under 50% of their target hours in 2 or more of the last 4 weeks, or 2 or more unexcused absences in their last 6 meetings.</p>
        </div>
        {view.drifting.length === 0 ? (
          <p className="text-sm text-muted">Nobody right now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {view.drifting.map((d) => (
              <li key={d.memberId} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-4">
                <span className="flex min-w-44 items-center gap-2 font-medium">
                  {d.name} <TierBadge tier={d.tier} />
                </span>
                <ul className="flex-1 text-sm text-fg-2">
                  {d.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <Link href={`/admin/hours/${d.memberId}`} className="text-sm font-medium text-link underline underline-offset-2">
                  History →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard
          id="hours-week"
          title="Hours this week vs target"
          summary={`${onTrack} of ${view.hoursThisWeek.length} members are on track (pro-rated to today).${furthest && !furthest.onTrack ? ` Furthest behind: ${furthest.name} (${Math.round(furthest.pct * 100)}% of ${furthest.target} h).` : ""}`}
          table={
            <DataTable
              head={["Member", "Tier", "Hours", "Target", "Status"]}
              rows={view.hoursThisWeek.map((r) => [r.name, r.tier, h1(r.hours), r.target, r.pace === "met" ? "Target met" : r.onTrack ? "On track" : "Behind"])}
            />
          }
        >
          <Legend
            kind="rect"
            items={[
              { label: "On track or met (✓)", color: "var(--viz-1)" },
              { label: "Behind (!)", color: "var(--viz-2)" },
            ]}
          />
          <p className="-mt-1 text-xs text-subtle">Bars show % of each member&apos;s own weekly target; the tick marks 100%.</p>
          <HBarChart
            ariaLabel="Hours this week per member as a share of their weekly target"
            unit="hours"
            max={150}
            rows={view.hoursThisWeek.map((r) => ({
              key: r.memberId,
              label: r.name,
              value: Math.min(150, r.pct * 100),
              target: 100,
              color: r.onTrack ? "var(--viz-1)" : "var(--viz-2)",
              valueLabel: `${r.onTrack ? "✓" : "!"} ${h1(r.hours)} / ${r.target} h`,
              note: r.pace === "met" ? "Target met" : r.onTrack ? "On track" : "Behind",
            }))}
          />
        </ChartCard>

        <ChartCard
          id="hours-tier"
          title="Hours per week by tier"
          summary={`The last point is this week so far (${h1(thisWeekTotal)} h).${lastFull ? ` Last full week: ${view.tiers.map((t) => `${t} ${h1(lastFull[t] ?? 0)} h`).join(", ")}.` : ""}`}
          table={<DataTable head={["Week of", ...view.tiers]} rows={view.hoursByTier.map((r) => [fmtWeek(r.week), ...view.tiers.map((t) => h1(r[t] ?? 0))])} />}
        >
          <LineChart
            ariaLabel="Total hours per week by tier"
            unit="h"
            xLabels={weekLabels}
            series={view.tiers.map((t) => ({ key: t, label: t, color: TIER_COLOR[t], values: view.hoursByTier.map((r) => r[t] ?? 0) }))}
          />
        </ChartCard>

        <ChartCard
          id="location-week"
          title="Office vs home hours per week"
          summary={
            locKnown > 0
              ? `In this range: office ${h1(locTotal.office)} h, home ${h1(locTotal.home)} h (${Math.round((locTotal.office / locKnown) * 100)}% in the office, of hours with a location).${locTotal.unspecified > 0 ? ` ${h1(locTotal.unspecified)} h are unspecified (logged before the location was asked).` : ""}`
              : "No hours with a location in this range yet. Older and imported hours show as unspecified."
          }
          table={<DataTable head={["Week of", "Office", "Home", "Unspecified"]} rows={view.locationByWeek.map((r) => [fmtWeek(r.week), h1(r.office), h1(r.home), h1(r.unspecified)])} />}
        >
          <LineChart
            ariaLabel="Office, home and unspecified hours per week"
            unit="h"
            xLabels={weekLabels}
            series={LOCATION_PARTS.map((p) => ({ key: p.key, label: p.label, color: p.color, values: view.locationByWeek.map((r) => r[p.key]) }))}
          />
        </ChartCard>

        <ChartCard
          id="location-tier"
          title="Office vs home hours by tier"
          summary="Total hours in this range per tier, split by where they were worked."
          table={<DataTable head={["Tier", "Office", "Home", "Unspecified"]} rows={view.locationByTier.map((r) => [r.tier, h1(r.office), h1(r.home), h1(r.unspecified)])} />}
        >
          <StackedBarChart
            ariaLabel="Office, home and unspecified hours per tier"
            unit="h"
            parts={[...LOCATION_PARTS]}
            rows={view.locationByTier.map((r) => ({ key: r.tier, label: r.tier, values: { office: r.office, home: r.home, unspecified: r.unspecified } }))}
          />
        </ChartCard>

        <ChartCard
          id="attendance-series"
          title="Attendance rate by meeting series"
          summary={
            bestSeries
              ? `Present or remote, out of all invitations (unanswered past meetings count as absences). Highest: ${bestSeries.series} ${bestSeries.rate}%${worstSeries && worstSeries !== bestSeries ? `; lowest: ${worstSeries.series} ${worstSeries.rate}%` : ""}.`
              : "No past meetings in this range."
          }
          table={<DataTable head={["Series", "Rate", "Attended", "Invitations"]} rows={view.attendanceBySeries.map((r) => [r.series, `${r.rate}%`, r.attended, r.total])} />}
        >
          <HBarChart
            ariaLabel="Attendance rate per meeting series"
            unit="attended"
            max={100}
            rows={view.attendanceBySeries.map((r) => ({ key: r.series, label: r.series, value: r.rate ?? 0, color: "var(--viz-1)", valueLabel: `${r.rate}%`, note: `${r.attended} of ${r.total} invitations` }))}
          />
        </ChartCard>

        <ChartCard
          id="tasks-member"
          title="Tasks finished per member"
          summary={
            view.finishedPerMember.length
              ? `${view.finishedPerMember.reduce((s, r) => s + r.n, 0)} tasks finished in ${RANGES[range].toLowerCase()}; most: ${view.finishedPerMember[0].name} (${view.finishedPerMember[0].n}). Unconfirmed AI tasks are not counted.`
              : `No tasks finished in ${RANGES[range].toLowerCase()}.`
          }
          table={<DataTable head={["Member", "Finished"]} rows={view.finishedPerMember.map((r) => [r.name, r.n])} />}
        >
          <HBarChart
            ariaLabel="Tasks finished per member"
            unit="finished"
            rows={view.finishedPerMember.map((r) => ({ key: r.memberId, label: r.name, value: r.n, color: "var(--viz-1)", valueLabel: String(r.n) }))}
          />
        </ChartCard>

        <ChartCard
          id="tasks-week"
          title="Tasks created vs finished per week"
          summary={`${createdTotal} created${view.anyAi ? ` (${aiTotal} by AI from meeting notes)` : ""} and ${finishedTotal} finished in ${RANGES[range].toLowerCase()}.`}
          table={
            <DataTable
              head={["Week of", "Created", ...(view.anyAi ? ["Created by AI"] : []), "Finished"]}
              rows={view.tasksPerWeek.map((w) => [fmtWeek(w.week), w.created, ...(view.anyAi ? [w.aiCreated ?? 0] : []), w.finished])}
            />
          }
        >
          <LineChart
            ariaLabel="Tasks created and finished per week"
            xLabels={weekLabels}
            series={[
              { key: "created", label: "Created", color: "var(--viz-1)", values: view.tasksPerWeek.map((w) => w.created) },
              { key: "finished", label: "Finished", color: "var(--viz-2)", values: view.tasksPerWeek.map((w) => w.finished) },
              ...(view.anyAi ? [{ key: "ai", label: "Created by AI", color: "var(--viz-3)", values: view.tasksPerWeek.map((w) => w.aiCreated ?? 0) }] : []),
            ]}
          />
        </ChartCard>

        <ChartCard
          id="heatmap"
          title="Attendance: members × recent meetings"
          summary={`The last ${view.heatmap.meetings.length} past meetings${series ? ` of ${series}` : ""} in range. A dash means not invited.`}
          table={
            <DataTable
              head={["Member", ...view.heatmap.meetings.map((m) => `${m.series} ${fmtDate(m.startsAt)}`)]}
              rows={view.heatmap.rows.map((r) => [r.name, ...r.cells.map((c) => (c ? STATE_LABELS[c] : "–"))])}
            />
          }
        >
          <Legend kind="rect" items={(Object.keys(STATE_STYLE) as AttendanceState[]).map((s) => ({ label: `${STATE_STYLE[s].letter} ${STATE_LABELS[s]}`, color: STATE_STYLE[s].bg }))} />
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[2px] text-xs" aria-label="Attendance per member and meeting">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-surface" />
                  {view.heatmap.meetings.map((m) => (
                    <th key={m.id} scope="col" className="w-7 align-bottom font-normal text-subtle" title={`${m.title}, ${fmtDate(m.startsAt)}`}>
                      <span className="block whitespace-nowrap [writing-mode:vertical-rl] rotate-180">{fmtDate(m.startsAt)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.heatmap.rows.map((r) => (
                  <tr key={r.memberId}>
                    <th scope="row" className="sticky left-0 max-w-28 truncate bg-surface pr-2 text-left font-normal text-fg-2">
                      {r.name}
                    </th>
                    {r.cells.map((c, i) => {
                      const m = view.heatmap.meetings[i];
                      const label = `${r.name}, ${m.title} ${fmtDate(m.startsAt)}: ${c ? STATE_LABELS[c] : "not invited"}`;
                      return (
                        <td
                          key={i}
                          tabIndex={0}
                          title={label}
                          aria-label={label}
                          className="size-7 rounded text-center font-semibold outline-none focus-visible:ring-2 focus-visible:ring-fg"
                          style={c ? { background: STATE_STYLE[c].bg, color: STATE_STYLE[c].ink } : { color: "var(--subtle)" }}
                        >
                          {c ? STATE_STYLE[c].letter : "–"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold text-fg sm:text-3xl">{value}</p>
      <p className="text-xs text-subtle">{note}</p>
    </div>
  );
}
