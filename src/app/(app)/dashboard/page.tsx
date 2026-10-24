import Link from "next/link";
import { TierBadge } from "@/components/badges";
import { WeekProgress } from "@/components/hours";
import { AttendanceBadge, meetingWhen, SeriesBadge } from "@/components/meetings";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { memberWeek } from "@/lib/hours/queries";
import { weekStartOf } from "@/lib/hours/time";
import { syncCalendarInBackground } from "@/lib/meetings/auto-sync";
import { myMeetings } from "@/lib/meetings/queries";
import { meetingPhase } from "@/lib/meetings/rules";
import { TimerCard } from "../hours/timer-card";
import { NowMeetingCard } from "../meetings/now-card";

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIMEZONE }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Always rendered fresh: the timer and weekly totals must never come from a cached copy.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const member = await requireMember();
  syncCalendarInBackground();
  const firstName = member.name.split(" ")[0];
  const now = new Date();
  const [week, meetings] = await Promise.all([memberWeek(member.id, weekStartOf(now), now), myMeetings(member.id)]);
  const confirmed = meetings.filter((r) => r.meeting.status === "confirmed");
  const happening = confirmed.filter((r) => meetingPhase(r.meeting, now) === "open");
  const next = confirmed.find((r) => meetingPhase(r.meeting, now) === "upcoming");

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {greeting(now)}, {firstName}.
      </h1>
      <p className="flex flex-wrap items-center gap-2 text-slate-600">
        <TierBadge tier={member.tier} />
        <span>Your weekly commitment is {member.weeklyHours} hours.</span>
      </p>
      {happening.map((r) => (
        <NowMeetingCard key={r.meeting.id} meeting={r.meeting} state={r.state} note={r.note} source={r.source} now={now} />
      ))}
      <TimerCard startedAt={week.running?.startedAt.toISOString() ?? null} renderedAt={now.toISOString()} />
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <WeekProgress totalMs={week.totalMs} targetHours={member.weeklyHours} />
        <Link href="/hours" className="self-end text-sm font-medium text-slate-600 hover:text-slate-900">
          Your hours →
        </Link>
      </div>
      {next && (
        <Link href={`/meetings/${next.meeting.id}`} className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50" data-testid="next-meeting">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next meeting</span>
          <span className="font-semibold">{next.meeting.title}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {meetingWhen(next.meeting)}
            <SeriesBadge series={next.meeting.series} />
            {next.state && <AttendanceBadge state={next.state} />}
          </span>
        </Link>
      )}
    </section>
  );
}
