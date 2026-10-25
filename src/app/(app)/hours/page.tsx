import Link from "next/link";
import { EntryList, WeekHistory } from "@/components/hours";
import { DayBarsChart, ProgressRing, SplitBar, TrendBars } from "@/components/hours-charts";
import { ChartCard, DataTable } from "@/components/charts";
import { PaceBadge } from "@/components/hours";
import { quietLinkClass } from "@/components/ui";
import { PageTitle, Section } from "@/components/ui-kit";
import { requireMember } from "@/lib/auth";
import { dailyHours, shortDay } from "@/lib/hours/daily";
import { lastLocation, memberWeekAndHistory } from "@/lib/hours/queries";
import { formatHours, formatWeek, fromFirstWeekWithHours, isWeekStart, weekBounds, weekPace, weekStartOf } from "@/lib/hours/time";
import { TimerCard } from "./timer-card";

// Always rendered fresh: the timer and weekly totals must never come from a cached copy.
export const dynamic = "force-dynamic";

const HOUR = 3_600_000;

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  const now = new Date();
  const thisWeek = weekStartOf(now);
  const week = sp.week && isWeekStart(sp.week) && sp.week <= thisWeek ? sp.week : thisWeek;
  const isThisWeek = week === thisWeek;
  const [{ data, history }, defaultLocation] = await Promise.all([memberWeekAndHistory(me.id, week, thisWeek, 8, now), lastLocation(me.id)]);
  const weekHref = (w: string) => (w === thisWeek ? "/hours" : `/hours?week=${w}`);

  const hours = data.totalMs / HOUR;
  const b = weekBounds(week);
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - b.from.getTime()) / (b.to.getTime() - b.from.getTime())));
  const pace = weekPace(data.totalMs, me.weeklyHours, isThisWeek ? elapsed : 1);
  const days = dailyHours(data.entries, week, now);
  const perDay = me.weeklyHours / 5;
  const trend = [...fromFirstWeekWithHours(history)].reverse().map((w) => ({
    week: w.week,
    label: shortDay(w.week),
    hours: Math.round((w.totalMs / HOUR) * 10) / 10,
    href: weekHref(w.week),
    selected: w.week === week,
  }));
  const label = isThisWeek ? "This week" : `Week of ${formatWeek(week)}`;
  const r1 = (n: number) => Math.round(n * 10) / 10;

  return (
    <section className="flex max-w-3xl flex-col gap-10">
      <PageTitle accent="hours" sub={`Your commitment is ${me.weeklyHours} h a week.`}>
        Your
      </PageTitle>

      {isThisWeek && (
        <Section n={1} title="Track" action={<Link href="/hours/new" className={quietLinkClass}>Add time manually</Link>}>
          <TimerCard startedAt={data.running?.startedAt.toISOString() ?? null} renderedAt={now.toISOString()} location={data.running?.location} defaultLocation={defaultLocation} />
        </Section>
      )}

      <Section n={isThisWeek ? 2 : 1} title={label} action={!isThisWeek ? <Link href="/hours" className={quietLinkClass}>Back to this week</Link> : undefined}>
        <div className="flex flex-col gap-6 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6" data-testid="week-progress">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
            <ProgressRing hours={r1(hours)} target={me.weeklyHours} />
            <div className="flex w-full min-w-0 flex-col gap-4">
              <span className="self-start"><PaceBadge pace={pace} /></span>
              <p className="text-sm text-muted">
                {hours >= me.weeklyHours ? "Target reached. Anything more is a bonus." : `${formatHours(Math.max(0, me.weeklyHours * HOUR - data.totalMs))} h to go this week.`}
              </p>
              <SplitBar office={r1(data.byLocation.office / HOUR)} home={r1(data.byLocation.home / HOUR)} unspecified={r1(data.byLocation.unspecified / HOUR)} />
            </div>
          </div>
        </div>
        <ChartCard
          title="Day by day"
          summary={`${formatHours(data.totalMs)} h in total. The dashed line is an even pace of ${r1(perDay)} h a working day.`}
          table={<DataTable head={["Day", "Hours", "Office", "Home"]} rows={days.map((d) => [d.label, r1(d.hours), r1(d.office), r1(d.home)])} />}
        >
          <DayBarsChart days={days} targetPerDay={perDay} ariaLabel={`Hours per day, ${label}`} />
        </ChartCard>
      </Section>

      <Section n={isThisWeek ? 3 : 2} title="Last 8 weeks">
        {trend.length > 1 ? (
          <ChartCard
            title="Week by week"
            summary={`${trend.filter((t) => t.hours >= me.weeklyHours).length} of ${trend.length} weeks at target (${me.weeklyHours} h). Click a bar to open that week.`}
            table={<DataTable head={["Week", "Hours"]} rows={trend.map((t) => [t.label, t.hours])} />}
          >
            <TrendBars weeks={trend} target={me.weeklyHours} ariaLabel="Hours per week against the weekly target" />
          </ChartCard>
        ) : (
          <p className="text-sm text-muted">The weekly overview appears after your first full week.</p>
        )}
        <details className="group">
          <summary className={`${quietLinkClass} cursor-pointer`}>Every week as a list</summary>
          <div className="mt-3">
            <WeekHistory weeks={history} targetHours={me.weeklyHours} selected={week} hrefFor={weekHref} />
          </div>
        </details>
      </Section>

      <Section n={isThisWeek ? 4 : 3} title="Entries">
        <EntryList entries={data.entries} viewer={me} thisWeekStart={weekBounds(thisWeek).from} returnTo={weekHref(week)} now={now} />
      </Section>
    </section>
  );
}
