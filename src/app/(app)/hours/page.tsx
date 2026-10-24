import Link from "next/link";
import { EntryList, WeekHistory, WeekProgress } from "@/components/hours";
import { secondaryButtonClass } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { memberWeek, weeklyTotals } from "@/lib/hours/queries";
import { formatWeek, isWeekStart, weekBounds, weekStartOf } from "@/lib/hours/time";
import { TimerCard } from "./timer-card";

// Always rendered fresh: the timer and weekly totals must never come from a cached copy.
export const dynamic = "force-dynamic";

export default async function HoursPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  const now = new Date();
  const thisWeek = weekStartOf(now);
  const week = sp.week && isWeekStart(sp.week) && sp.week <= thisWeek ? sp.week : thisWeek;
  const isThisWeek = week === thisWeek;
  const [data, history] = await Promise.all([memberWeek(me.id, week, now), weeklyTotals(me.id, thisWeek, 8, now)]);
  const weekHref = (w: string) => (w === thisWeek ? "/hours" : `/hours?week=${w}`);

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hours</h1>
          <p className="text-sm text-muted">
            {isThisWeek ? "This week" : "Week of"} {formatWeek(week)} · your commitment is {me.weeklyHours} h a week
          </p>
        </div>
        {isThisWeek && (
          <Link href="/hours/new" className={secondaryButtonClass}>
            Add time manually
          </Link>
        )}
      </div>

      {isThisWeek && <TimerCard startedAt={data.running?.startedAt.toISOString() ?? null} renderedAt={now.toISOString()} />}

      <WeekProgress totalMs={data.totalMs} targetHours={me.weeklyHours} label={isThisWeek ? "This week" : formatWeek(week)} />
      <EntryList entries={data.entries} viewer={me} thisWeekStart={weekBounds(thisWeek).from} returnTo={weekHref(week)} now={now} />

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Recent weeks</h2>
        <WeekHistory weeks={history} targetHours={me.weeklyHours} selected={week} hrefFor={weekHref} />
      </div>
    </section>
  );
}
