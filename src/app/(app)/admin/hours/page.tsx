import Link from "next/link";
import { ChartCard, DataTable } from "@/components/charts";
import { MemberHoursChart, PaceLegend, StackedColumnChart, type MemberBar } from "@/components/hours-charts";
import { Legend } from "@/components/charts";
import { quietLinkClass, secondaryButtonClass } from "@/components/ui";
import { PageTitle, Section } from "@/components/ui-kit";
import { requireAdmin } from "@/lib/auth";
import { loadWeeklyHours } from "@/lib/analytics/weekly-hours";
import { shortDay } from "@/lib/hours/daily";
import { hoursSheetQueue, teamWeek } from "@/lib/hours/queries";
import { hoursSheetTab } from "@/lib/hours/sheet-sync";
import { addDays, formatHours, formatWeek, isWeekStart, weekBounds, weekPace, weekStartOf, type Pace } from "@/lib/hours/time";
import { SheetPanel } from "./sheet-panel";

const HOUR = 3_600_000;
const TIERS = ["Core", "Impact", "GO!"] as const;
const TIER_COLOR: Record<string, string> = { Core: "var(--viz-1)", Impact: "var(--viz-2)", "GO!": "var(--viz-3)" };
const PACE_LABEL: Record<Pace, string> = { met: "target met", on_track: "on track", behind: "behind", below: "below target" };
// Most urgent first.
const PACE_ORDER: Record<Pace, number> = { behind: 0, below: 1, on_track: 2, met: 3 };

export default async function AdminHoursPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const thisWeek = weekStartOf(now);
  const week = sp.week && isWeekStart(sp.week) && sp.week <= thisWeek ? sp.week : thisWeek;
  const isThisWeek = week === thisWeek;
  const { from, to } = weekBounds(week);
  const elapsed = isThisWeek ? (now.getTime() - from.getTime()) / (to.getTime() - from.getTime()) : 1;
  const trendWeeks = Array.from({ length: 8 }, (_, i) => addDays(week, -7 * (7 - i)));

  // Queries start together with the admin check (they do not depend on who is asking).
  const [, team, queue, weekly] = await Promise.all([requireAdmin(), teamWeek(week, now), hoursSheetQueue(), loadWeeklyHours(trendWeeks, now)]);
  const rows = team
    .map((m) => ({ ...m, pace: weekPace(m.totalMs, m.weeklyHours, elapsed), pct: Math.round((m.totalMs / HOUR / m.weeklyHours) * 100) }))
    .sort((a, b) => PACE_ORDER[a.pace] - PACE_ORDER[b.pace] || a.pct - b.pct);
  const behind = rows.filter((r) => r.pace === "behind" || r.pace === "below").length;
  const working = rows.filter((r) => r.working).length;
  const weekHref = (w: string) => (w === thisWeek ? "/admin/hours" : `/admin/hours?week=${w}`);
  const r1 = (n: number) => Math.round(n * 10) / 10;

  const groups = TIERS.map((tier) => ({
    tier,
    bars: rows
      .filter((m) => m.tier === tier)
      .map<MemberBar>((m) => ({
        id: m.id,
        name: m.name,
        hours: r1(m.totalMs / HOUR),
        target: m.weeklyHours,
        pace: m.pace,
        paceLabel: PACE_LABEL[m.pace],
        working: m.working,
        href: `/admin/hours/${m.id}${isThisWeek ? "" : `?week=${week}`}`,
      })),
  })).filter((g) => g.bars.length > 0);

  const tierOf = new Map(team.map((m) => [m.id, m.tier]));
  const series = TIERS.map((tier) => ({
    key: tier,
    label: tier,
    color: TIER_COLOR[tier],
    values: trendWeeks.map((w) => r1(weekly.filter((h) => h.week === w && tierOf.get(h.memberId) === tier).reduce((s, h) => s + h.ms, 0) / HOUR)),
  })).filter((s) => s.values.some((v) => v > 0));
  const xLabels = trendWeeks.map(shortDay);

  return (
    <section className="flex max-w-4xl flex-col gap-10">
      <PageTitle
        accent="hours"
        sub={`${isThisWeek ? "This week" : "Week of"} ${formatWeek(week)} · ${behind} ${isThisWeek ? "behind" : "below target"} · ${working} working now`}
      >
        Team
      </PageTitle>

      <Section
        n={1}
        title="This week"
        action={
          <nav aria-label="Week" className="flex items-center gap-2">
            <Link href={weekHref(addDays(week, -7))} className={secondaryButtonClass}>
              ← Previous
            </Link>
            {!isThisWeek && (
              <Link href={weekHref(addDays(week, 7))} className={secondaryButtonClass}>
                Next →
              </Link>
            )}
          </nav>
        }
      >
        <ChartCard
          title="Hours against each member's target"
          summary={
            isThisWeek
              ? `The black tick is the weekly target. “Behind” means under 75% of the hours expected by now (${Math.round(elapsed * 100)}% of the week has passed). Click a bar for that member's history.`
              : "The black tick is the weekly target. Click a bar for that member's history."
          }
          table={
            <DataTable
              head={["Member", "Tier", "Hours", "Target", "Status"]}
              rows={rows.map((m) => [m.name, m.tier, formatHours(m.totalMs), m.weeklyHours, PACE_LABEL[m.pace] + (m.working ? ", working now" : "")])}
            />
          }
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <PaceLegend />
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: "var(--viz-3)" }} /> Working now
            </span>
          </div>
          <div className="flex flex-col gap-6" data-testid="team-hours">
            {groups.map((g) => (
              <div key={g.tier} className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold uppercase tracking-eyebrow text-muted">
                  {g.tier} <span className="font-normal normal-case tracking-normal text-subtle">· {g.bars.length} {g.bars.length === 1 ? "member" : "members"}</span>
                </h3>
                <MemberHoursChart rows={g.bars} ariaLabel={`${g.tier} members: hours this week against target`} />
              </div>
            ))}
          </div>
        </ChartCard>
      </Section>

      <Section n={2} title="Last 8 weeks">
        {series.length > 0 ? (
          <ChartCard
            title="Hours per week, by tier"
            summary={`Everyone's hours added up for the 8 weeks up to ${formatWeek(week)}.`}
            table={<DataTable head={["Week", ...series.map((s) => s.label)]} rows={xLabels.map((l, i) => [l, ...series.map((s) => s.values[i])])} />}
          >
            <Legend kind="rect" items={series.map((s) => ({ label: s.label, color: s.color }))} />
            <StackedColumnChart xLabels={xLabels} series={series} ariaLabel="Team hours per week stacked by tier" />
          </ChartCard>
        ) : (
          <p className="text-sm text-muted">No hours were logged in these weeks.</p>
        )}
      </Section>

      <Section n={3} title="Google Sheet">
        <details open={queue.pending > 0 || !!queue.lastError}>
          <summary className={`${quietLinkClass} cursor-pointer`}>
            {queue.pending > 0 ? `${queue.pending} entries waiting to sync` : queue.lastError ? "Last sync failed" : "Synced, show details"}
          </summary>
          <div className="mt-3">
            <SheetPanel tab={hoursSheetTab()} pending={queue.pending} failed={queue.failed} lastError={queue.lastError} />
          </div>
        </details>
      </Section>
    </section>
  );
}
