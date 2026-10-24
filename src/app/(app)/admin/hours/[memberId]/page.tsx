import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TierBadge } from "@/components/badges";
import { EntryList, WeekHistory, WeekProgress } from "@/components/hours";
import { secondaryButtonClass } from "@/components/ui";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { memberWeek, weeklyTotals } from "@/lib/hours/queries";
import { formatWeek, isWeekStart, weekBounds, weekStartOf } from "@/lib/hours/time";

/** One member's hours, any week, with editing (admins can change any entry). */
export default async function AdminMemberHoursPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const [admin, { memberId: rawId }, sp] = await Promise.all([requireAdmin(), params, searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const [member] = await db
    .select({ id: members.id, name: members.name, tier: members.tier, weeklyHours: members.weeklyHours })
    .from(members)
    .where(eq(members.id, id))
    .limit(1);
  if (!member) notFound();

  const now = new Date();
  const thisWeek = weekStartOf(now);
  const week = sp.week && isWeekStart(sp.week) && sp.week <= thisWeek ? sp.week : thisWeek;
  const [data, history] = await Promise.all([memberWeek(member.id, week, now), weeklyTotals(member.id, thisWeek, 8, now)]);
  const weekHref = (w: string) => (w === thisWeek ? `/admin/hours/${member.id}` : `/admin/hours/${member.id}?week=${w}`);
  const here = weekHref(week);

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <Link href={week === thisWeek ? "/admin/hours" : `/admin/hours?week=${week}`} className="text-sm text-slate-500 hover:text-slate-900">
        ← Hours
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {member.name} <TierBadge tier={member.tier} />
          </h1>
          <p className="text-sm text-slate-600">
            Week of {formatWeek(week)}
            {data.running && <span className="font-medium text-emerald-700"> · working now</span>}
          </p>
        </div>
        <Link href={`/hours/new?member=${member.id}&returnTo=${encodeURIComponent(here)}`} className={secondaryButtonClass}>
          Add time for {member.name.split(" ")[0]}
        </Link>
      </div>
      <WeekProgress totalMs={data.totalMs} targetHours={member.weeklyHours} label={week === thisWeek ? "This week" : formatWeek(week)} />
      <EntryList entries={data.entries} viewer={admin} thisWeekStart={weekBounds(thisWeek).from} returnTo={here} now={now} />
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Recent weeks</h2>
        <WeekHistory weeks={history} targetHours={member.weeklyHours} selected={week} hrefFor={weekHref} />
      </div>
    </section>
  );
}
