import { and, asc, count, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
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
import { RecorderPanel } from "@/components/recorder/recorder-panel";
import { meetings as meetingsTable } from "@/db/schema";
import { aiEnabled } from "@/lib/ai/meeting-tasks";
import { notesWaitingForTasks } from "@/lib/ai/pending-notes";
import { storageConfigured } from "@/lib/storage/supabase";

/** Meetings an admin may record from the dashboard: from two days ago to tomorrow; the one happening now first. */
async function recordableMeetings(now: Date) {
  const rows = await db
    .select({ id: meetingsTable.id, title: meetingsTable.title, startsAt: meetingsTable.startsAt, endsAt: meetingsTable.endsAt })
    .from(meetingsTable)
    .where(and(eq(meetingsTable.status, "confirmed"), gte(meetingsTable.startsAt, new Date(now.getTime() - 2 * 86_400_000)), lte(meetingsTable.startsAt, new Date(now.getTime() + 86_400_000))))
    .orderBy(asc(meetingsTable.startsAt));
  const isNow = (m: (typeof rows)[number]) => m.startsAt.getTime() - 15 * 60_000 <= now.getTime() && now.getTime() <= m.endsAt.getTime();
  const fmt = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
  const list = rows.map((m) => ({ id: m.id, title: m.title, label: `${m.title} · ${fmt(m.startsAt)}${isNow(m) ? " (now)" : ""}`, now: isNow(m) }));
  return { list: [...list.filter((m) => m.now), ...list.filter((m) => !m.now)], nowId: list.find((m) => m.now)?.id ?? null };
}

// Transcribing a recording (started from the dashboard's recorder) runs in the background.
export const maxDuration = 300;

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
  const [week, meetings, [openTasks], myOpen, defaultLocation, recordable, waitingNotes] = await Promise.all([
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
    member.isAdmin ? recordableMeetings(now) : null,
    aiEnabled() ? notesWaitingForTasks(member) : null,
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
      {waitingNotes && waitingNotes.total > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="notes-waiting">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Create tasks for meetings</span>
          <span className="font-semibold">
            {waitingNotes.total} meeting {waitingNotes.total === 1 ? "note is" : "notes are"} waiting for “Create tasks from notes”
          </span>
          <ul className="flex flex-col gap-1 text-sm">
            {waitingNotes.meetings.slice(0, 4).map((m) => (
              <li key={m.meetingId}>
                <Link href={`/meetings/${m.meetingId}#notes`} className="text-fg-2 underline-offset-2 hover:underline">
                  {m.title} · {m.startsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TIMEZONE })}
                  {m.notes > 1 ? ` (${m.notes})` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recordable && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="record-card">
          <span className="text-xs font-semibold uppercase tracking-wide text-subtle">Record meeting · admins</span>
          <RecorderPanel meetings={recordable.list} initialId={recordable.nowId} storageReady={storageConfigured()} />
        </div>
      )}
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
