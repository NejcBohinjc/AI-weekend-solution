import { and, asc, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { TierBadge } from "@/components/badges";
import { cardClass, quietLinkClass } from "@/components/ui";
import { Arrow, EmptyState, PageTitle, Section } from "@/components/ui-kit";
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
import { myTasksCondition } from "@/lib/tasks/queries";
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
  const [week, meetings, myOpen, defaultLocation, recordable, waitingNotes] = await Promise.all([
    memberWeek(member.id, weekStartOf(now), now),
    myMeetings(member.id),
    // My open tasks, soonest due first, for one-tap ticking here: the five shown, and in the same query
    // (window counts over all of them) the totals for the heading. Unconfirmed AI tasks are not counted as
    // the member's tasks until they confirm them.
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        kind: tasks.kind,
        n: sql<number>`(count(*) filter (where ${or(eq(tasks.createdByAi, false), isNotNull(tasks.aiConfirmedAt))}) over ())::int`,
        review: sql<number>`(count(*) filter (where ${and(eq(tasks.createdByAi, true), isNull(tasks.aiConfirmedAt))}) over ())::int`,
        department: sql<number>`(count(*) filter (where ${isNull(tasks.assigneeId)}) over ())::int`,
      })
      .from(tasks)
      // As under My tasks: assigned to me (also general tasks I hold), or to one of my departments and not taken yet.
      .where(and(myTasksCondition(member), ne(tasks.status, "done"), isNull(tasks.deletedAt)))
      .orderBy(sql`${tasks.dueDate} asc nulls last`, tasks.title)
      .limit(5),
    lastLocation(member.id),
    member.isAdmin ? recordableMeetings(now) : null,
    aiEnabled() ? notesWaitingForTasks(member) : null,
  ]);
  const openTasks = { n: myOpen[0]?.n ?? 0, review: myOpen[0]?.review ?? 0, department: myOpen[0]?.department ?? 0 };
  const confirmed = meetings.filter((r) => r.meeting.status === "confirmed");
  const happening = confirmed.filter((r) => meetingPhase(r.meeting, now) === "open");
  const next = confirmed.find((r) => meetingPhase(r.meeting, now) === "upcoming");

  const today = todayInLjubljana();
  return (
    <section className="flex max-w-2xl flex-col gap-10">
      <PageTitle
        accent={firstName}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <TierBadge tier={member.tier} />
            Your weekly commitment is {member.weeklyHours} hours.
          </span>
        }
      >
        {greeting(now)},
      </PageTitle>

      {happening.map((r) => (
        <NowMeetingCard key={r.meeting.id} meeting={r.meeting} state={r.state} note={r.note} source={r.source} now={now} />
      ))}

      <Section n={1} title="This week" action={<Link href="/hours" className={quietLinkClass}>Hours history</Link>}>
        <div className={`${cardClass} flex flex-col gap-6`}>
          <TimerCard startedAt={week.running?.startedAt.toISOString() ?? null} renderedAt={now.toISOString()} location={week.running?.location} defaultLocation={defaultLocation} />
          <div className="border-t border-line pt-5">
            <WeekProgress totalMs={week.totalMs} targetHours={member.weeklyHours} byLocation={week.byLocation} />
          </div>
        </div>
      </Section>

      <Section n={2} title="Your tasks" action={<Link href="/tasks/new" className={quietLinkClass}>+ New task</Link>}>
        {myOpen.length > 0 ? (
          <div className={`${cardClass} flex flex-col gap-1 !p-0`} data-testid="tasks-card">
            <ul className="divide-y divide-line px-5" aria-label="My open tasks">
              {myOpen.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-3.5">
                  <DoneToggle taskId={t.id} title={t.title} done={false} general={t.kind === "general"} />
                  <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {t.title}
                  </Link>
                  {t.dueDate && <DueDate date={t.dueDate} today={today} done={false} />}
                </li>
              ))}
            </ul>
            <Link href="/tasks" className="group flex items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-sm font-medium text-muted hover:text-fg">
              <span>
                {openTasks.n} open {openTasks.n === 1 ? "task" : "tasks"}
                {openTasks.department > 0 && ` · ${openTasks.department} for your department`}
                {openTasks.review > 0 && <span className="text-violet"> · {openTasks.review} from AI to review</span>}
              </span>
              <span className="flex items-center gap-1.5">
                All tasks <Arrow />
              </span>
            </Link>
          </div>
        ) : (
          <EmptyState title="Nothing on your plate." hint="Add a task for yourself, or pick up a general task." href="/tasks/new" action="Add a task" />
        )}
      </Section>

      {(next || (waitingNotes && waitingNotes.total > 0)) && (
        <Section n={3} title="Next up">
          {next && (
            <Link href={`/meetings/${next.meeting.id}`} className={`${cardClass} group flex flex-col gap-2 transition hover:bg-surface-2`} data-testid="next-meeting">
              <span className="font-display text-xl font-semibold tracking-display">{next.meeting.title}</span>
              <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                {meetingWhen(next.meeting)}
                <SeriesBadge series={next.meeting.series} />
                {next.state && <AttendanceBadge state={next.state} />}
              </span>
            </Link>
          )}
          {waitingNotes && waitingNotes.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-3 px-5 py-3.5 text-sm" data-testid="notes-waiting">
              <span className="text-fg-2">
                {waitingNotes.total} meeting {waitingNotes.total === 1 ? "note is" : "notes are"} waiting for tasks:{" "}
                {waitingNotes.meetings.slice(0, 2).map((m, i) => (
                  <span key={m.meetingId}>
                    {i > 0 && ", "}
                    <Link href={`/meetings/${m.meetingId}#notes`} className="font-medium underline-offset-4 hover:underline">
                      {m.title} · {m.startsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TIMEZONE })}
                    </Link>
                  </span>
                ))}
                {waitingNotes.meetings.length > 2 && ` and ${waitingNotes.meetings.length - 2} more`}
              </span>
            </div>
          )}
        </Section>
      )}

      {recordable && (
        <details className="group rounded-card border border-line bg-surface" data-testid="record-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-display text-sm font-semibold">
            <span>Record a meeting <span className="font-sans font-normal text-subtle">· admins</span></span>
            <span aria-hidden className="text-muted transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-line p-5">
            <RecorderPanel meetings={recordable.list} initialId={recordable.nowId} storageReady={storageConfigured()} />
          </div>
        </details>
      )}
    </section>
  );
}
