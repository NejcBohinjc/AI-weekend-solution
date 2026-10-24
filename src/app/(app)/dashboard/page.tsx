import { and, count, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { TierBadge } from "@/components/badges";
import { WeekProgress } from "@/components/hours";
import { AttendanceBadge, meetingWhen, SeriesBadge } from "@/components/meetings";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { lastLocation, memberWeek } from "@/lib/hours/queries";
import { weekStartOf } from "@/lib/hours/time";
import { syncCalendarInBackground } from "@/lib/meetings/auto-sync";
import { myMeetings } from "@/lib/meetings/queries";
import { meetingPhase } from "@/lib/meetings/rules";
import { DueDate } from "@/components/task-badges";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { TimerCard } from "../hours/timer-card";
import { DoneToggle } from "../tasks/done-toggle";
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
  const [week, meetings, [openTasks], myOpen, defaultLocation] = await Promise.all([
    memberWeek(member.id, weekStartOf(now), now),
    myMeetings(member.id),
    db
      .select({
        // Unconfirmed AI tasks are not counted as the member's tasks until they confirm them.
        n: count(sql`case when ${or(eq(tasks.createdByAi, false), isNotNull(tasks.aiConfirmedAt))} then 1 end`),
        review: count(sql`case when ${and(eq(tasks.createdByAi, true), isNull(tasks.aiConfirmedAt))} then 1 end`),
      })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, member.id), ne(tasks.status, "done"), isNull(tasks.deletedAt), eq(tasks.kind, "project"))),
    // My open tasks, soonest due first, for one-tap ticking here.
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, member.id), ne(tasks.status, "done"), isNull(tasks.deletedAt), eq(tasks.kind, "project")))
      .orderBy(sql`${tasks.dueDate} asc nulls last`, tasks.title)
      .limit(5),
    lastLocation(member.id),
  ]);
  const confirmed = meetings.filter((r) => r.meeting.status === "confirmed");
  const happening = confirmed.filter((r) => meetingPhase(r.meeting, now) === "open");
  const next = confirmed.find((r) => meetingPhase(r.meeting, now) === "upcoming");

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {greeting(now)}, {firstName}.
      </h1>
      <p className="flex flex-wrap items-center gap-2 text-muted">
        <TierBadge tier={member.tier} />
        <span>Your weekly commitment is {member.weeklyHours} hours.</span>
      </p>
      {happening.map((r) => (
        <NowMeetingCard key={r.meeting.id} meeting={r.meeting} state={r.state} note={r.note} source={r.source} now={now} />
      ))}
      <TimerCard startedAt={week.running?.startedAt.toISOString() ?? null} renderedAt={now.toISOString()} location={week.running?.location} defaultLocation={defaultLocation} />
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
        <WeekProgress totalMs={week.totalMs} targetHours={member.weeklyHours} byLocation={week.byLocation} />
        <Link href="/hours" className="self-end text-sm font-medium text-muted hover:text-fg">
          Your hours →
        </Link>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-testid="tasks-card">
        <div className="flex items-center justify-between gap-3">
          <Link href="/tasks" className="flex flex-col hover:text-fg-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Your tasks</span>
            <span className="font-semibold">
              {openTasks.n} open {openTasks.n === 1 ? "task" : "tasks"}
            </span>
            {openTasks.review > 0 && <span className="text-sm font-medium text-violet">{openTasks.review} from AI to review</span>}
          </Link>
          <Link href="/tasks/new" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
            New task
          </Link>
        </div>
        {myOpen.length > 0 && (
          <ul className="divide-y divide-line border-t border-line" aria-label="My open tasks">
            {myOpen.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <DoneToggle taskId={t.id} title={t.title} done={false} />
                <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {t.title}
                </Link>
                {t.dueDate && <DueDate date={t.dueDate} today={todayInLjubljana()} done={false} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      {next && (
        <Link href={`/meetings/${next.meeting.id}`} className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 hover:bg-surface-2" data-testid="next-meeting">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Next meeting</span>
          <span className="font-semibold">{next.meeting.title}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {meetingWhen(next.meeting)}
            <SeriesBadge series={next.meeting.series} />
            {next.state && <AttendanceBadge state={next.state} />}
          </span>
        </Link>
      )}
    </section>
  );
}
