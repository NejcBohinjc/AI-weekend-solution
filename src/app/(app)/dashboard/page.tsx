import Link from "next/link";
import { TierBadge } from "@/components/badges";
import { WeekProgress } from "@/components/hours";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { memberWeek } from "@/lib/hours/queries";
import { weekStartOf } from "@/lib/hours/time";
import { TimerCard } from "../hours/timer-card";

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIMEZONE }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const member = await requireMember();
  const firstName = member.name.split(" ")[0];
  const now = new Date();
  const week = await memberWeek(member.id, weekStartOf(now), now);

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {greeting(now)}, {firstName}.
      </h1>
      <p className="flex flex-wrap items-center gap-2 text-slate-600">
        <TierBadge tier={member.tier} />
        <span>Your weekly commitment is {member.weeklyHours} hours.</span>
      </p>
      <TimerCard startedAt={week.running?.startedAt.toISOString() ?? null} serverNow={now.toISOString()} />
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <WeekProgress totalMs={week.totalMs} targetHours={member.weeklyHours} />
        <Link href="/hours" className="self-end text-sm font-medium text-slate-600 hover:text-slate-900">
          Your hours →
        </Link>
      </div>
    </section>
  );
}
