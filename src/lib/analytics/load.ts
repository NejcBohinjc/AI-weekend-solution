// Loads what computeAnalytics() needs. Admin-only: called from the admin analytics page, which
// requireAdmin() guards; there is no API endpoint for this data.
//
// The hours are added up in SQL (per member, week and location, each entry clipped to the week exactly like
// overlapMs() does) and only for the weeks the page can show, so the number of time entries a year of use
// piles up never reaches JavaScript. Tasks are limited to the same window.
import "server-only";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, meetingInvites, meetings, members, tasks } from "@/db/schema";
import { addDays, weekBounds, weekStartOf } from "@/lib/hours/time";
import type { Data, Range } from "./compute";
import { loadWeeklyHours, weeksNeeded } from "./weekly-hours";

export async function loadAnalyticsData(now = new Date(), range: Range = "all"): Promise<Data> {
  const thisWeek = weekStartOf(now);
  const count = weeksNeeded(range);
  const weeks = Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i)));
  const since = weekBounds(weeks[0]).from;
  const { from: weekFrom, to: weekTo } = weekBounds(thisWeek);

  const [m, hours, misc, mtgs, invites, att, t] = await Promise.all([
    db.select({ id: members.id, name: members.name, tier: members.tier, weeklyHours: members.weeklyHours, active: members.active }).from(members),
    loadWeeklyHours(weeks, now),
    // Three small facts in one statement: when time was first logged, whether any live AI task exists
    // (both over all time), and who changed a task this week (for "active").
    db.execute(sql`
      select (select (extract(epoch from min(started_at)) * 1000)::float8 from time_entries where deleted_at is null) as first_ms,
             exists(select 1 from tasks where kind = 'project' and created_by_ai and deleted_at is null) as any_ai,
             (select coalesce(json_agg(distinct actor_id), '[]'::json) from task_events
               where actor_id is not null and source = 'app' and created_at >= ${weekFrom.toISOString()}::timestamptz and created_at < ${weekTo.toISOString()}::timestamptz) as active_ids`),
    db.select({ id: meetings.id, title: meetings.title, series: meetings.series, startsAt: meetings.startsAt, endsAt: meetings.endsAt, status: meetings.status }).from(meetings),
    db.select({ meetingId: meetingInvites.meetingId, memberId: meetingInvites.memberId }).from(meetingInvites),
    db
      .select({ meetingId: attendance.meetingId, memberId: attendance.memberId, state: attendance.state, lateNotice: attendance.lateNotice, lateDecision: attendance.lateDecision })
      .from(attendance),
    db
      .select({
        id: tasks.id,
        assigneeId: tasks.assigneeId,
        status: tasks.status,
        createdAt: tasks.createdAt,
        completedAt: tasks.completedAt,
        createdByAi: tasks.createdByAi,
        aiConfirmedAt: tasks.aiConfirmedAt,
        deletedAt: tasks.deletedAt,
      })
      .from(tasks)
      // General tasks are standing tasks, not counted. Only tasks created or finished in the window matter.
      .where(and(eq(tasks.kind, "project"), isNull(tasks.deletedAt), or(gte(tasks.createdAt, since), gte(tasks.completedAt, since)))),
  ]);
  const facts = (misc as unknown as { first_ms: number | null; any_ai: boolean; active_ids: number[] }[])[0];
  return {
    now,
    members: m,
    hours,
    firstEntryAt: facts.first_ms === null ? null : new Date(Math.round(Number(facts.first_ms))),
    meetings: mtgs,
    invites,
    attendance: att,
    tasks: t,
    anyAiTask: facts.any_ai,
    taskActivity: (facts.active_ids ?? []).map((memberId) => ({ memberId, at: weekFrom })),
  };
}
