// Loads the rows computeAnalytics() needs. Admin-only: called from the admin analytics page, which
// middleware and requireAdmin() guard; there is no API endpoint for this data.
import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attendance, meetingInvites, meetings, members, taskEvents, tasks, timeEntries } from "@/db/schema";
import type { Data } from "./compute";

export async function loadAnalyticsData(now = new Date()): Promise<Data> {
  const [m, entries, mtgs, invites, att, t, activity] = await Promise.all([
    db.select({ id: members.id, name: members.name, tier: members.tier, weeklyHours: members.weeklyHours, active: members.active }).from(members),
    db
      .select({ memberId: timeEntries.memberId, startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt })
      .from(timeEntries)
      .where(isNull(timeEntries.deletedAt)),
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
      .where(eq(tasks.kind, "project")), // general tasks are standing tasks, not counted
    db
      .select({ memberId: taskEvents.actorId, at: taskEvents.createdAt })
      .from(taskEvents)
      .where(and(isNotNull(taskEvents.actorId), eq(taskEvents.source, "app"))),
  ]);
  return {
    now,
    members: m,
    entries,
    meetings: mtgs,
    invites,
    attendance: att,
    tasks: t,
    taskActivity: activity.map((a) => ({ memberId: a.memberId!, at: a.at })),
  };
}
