// Admin analytics, computed from rows loaded in load.ts: the hours arrive already added up per member, week
// and location (in SQL, so thousands of time entries never reach JavaScript). Pure, so it is unit-tested
// (compute.test.ts). Definitions match the rest of the app: weekPace() for "on track", effectiveState()
// for attendance (an unanswered past meeting counts as unexcused), attendanceSummary() for rates.
// Unconfirmed AI-created tasks never count towards anyone's numbers. A finished task counts once, at its
// current completion time (tasks.completed_at): reopened tasks drop out, done again counts once.
import type { WorkLocation } from "@/lib/hours/constants";
import { emptyLocationTotals, type LocationTotals } from "@/lib/hours/location";
import { addDays, weekBounds, weekPace, weekStartOf, type Pace } from "@/lib/hours/time";
import type { AttendanceState } from "@/lib/meetings/constants";
import { attendanceSummary, effectiveState } from "@/lib/meetings/rules";
import { TIERS, type Tier } from "@/lib/tiers";

const HOUR = 3_600_000;

export type Range = "4w" | "8w" | "all";
export const RANGES: Record<Range, string> = { "4w": "Last 4 weeks", "8w": "Last 8 weeks", all: "All (up to 26 weeks)" };

export type Data = {
  now: Date;
  members: { id: number; name: string; tier: Tier; weeklyHours: number; active: boolean }[];
  /**
   * Time logged per member, week (its Monday, Europe/Ljubljana) and location, in ms: each entry clipped to
   * the week, a running timer counted up to `now`. location is null for entries from before it was recorded
   * (shown as "unspecified", never guessed). Only the weeks the page can show are loaded.
   */
  hours: { memberId: number; week: string; location: WorkLocation | null; ms: number }[];
  /** When anyone first logged time (sets how far back "All" reaches). */
  firstEntryAt: Date | null;
  meetings: { id: number; title: string; series: string; startsAt: Date; endsAt: Date; status: string }[];
  invites: { meetingId: number; memberId: number }[];
  attendance: { meetingId: number; memberId: number; state: AttendanceState; lateNotice?: boolean; lateDecision?: "accepted" | "rejected" | null }[];
  tasks: {
    id: number;
    assigneeId: number | null;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    createdByAi: boolean;
    aiConfirmedAt: Date | null;
    deletedAt: Date | null;
  }[];
  /** Is there any live AI-created task (all time, not only in `tasks`): decides whether the AI series is drawn. */
  anyAiTask: boolean;
  /** Any task change by a member this week (for "active"). */
  taskActivity: { memberId: number; at: Date }[];
};

export type Filters = { tier: Tier | null; series: string | null; range: Range };

export type Analytics = ReturnType<typeof computeAnalytics>;

export function computeAnalytics(d: Data, f: Filters) {
  const { now } = d;
  const thisWeek = weekStartOf(now);
  const { from: weekFrom, to: weekTo } = weekBounds(thisWeek);
  const weekElapsed = (now.getTime() - weekFrom.getTime()) / (weekTo.getTime() - weekFrom.getTime());
  const people = d.members.filter((m) => m.active && (!f.tier || m.tier === f.tier));
  const ids = new Set(people.map((p) => p.id));
  const meetingsShown = d.meetings.filter((m) => m.status === "confirmed" && (!f.series || m.series === f.series));

  // Weeks in range, oldest first, ending with the current week.
  const earliest = Math.min(now.getTime(), d.firstEntryAt?.getTime() ?? now.getTime(), ...d.meetings.map((m) => m.startsAt.getTime()));
  const weekCount =
    f.range === "4w" ? 4 : f.range === "8w" ? 8 : Math.min(26, Math.max(1, Math.round((weekFrom.getTime() - weekBounds(weekStartOf(new Date(earliest))).from.getTime()) / (7 * 86_400_000)) + 1));
  const weeks = Array.from({ length: weekCount }, (_, i) => addDays(thisWeek, -7 * (weekCount - 1 - i)));
  const rangeFrom = weekBounds(weeks[0]).from;

  // Hours per member and week; every question below is about whole weeks.
  const msByMemberWeek = new Map<string, number>();
  const hoursByWeek = new Map<string, Data["hours"]>();
  for (const r of d.hours) {
    msByMemberWeek.set(`${r.memberId}|${r.week}`, (msByMemberWeek.get(`${r.memberId}|${r.week}`) ?? 0) + r.ms);
    hoursByWeek.set(r.week, [...(hoursByWeek.get(r.week) ?? []), r]);
  }
  const hoursInWeek = (memberId: number, week: string) => (msByMemberWeek.get(`${memberId}|${week}`) ?? 0) / HOUR;

  // ---- Hours this week, per member ----
  const hoursThisWeek = people
    .map((p) => {
      const hours = hoursInWeek(p.id, thisWeek);
      const pace = weekPace(hours * HOUR, p.weeklyHours, Math.min(1, weekElapsed));
      return { memberId: p.id, name: p.name, tier: p.tier, hours, target: p.weeklyHours, pct: p.weeklyHours ? hours / p.weeklyHours : 0, pace, onTrack: pace === "met" || pace === "on_track" };
    })
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

  // ---- Hours per week by tier ----
  const tiers = f.tier ? [f.tier] : [...TIERS];
  const hoursByTier = weeks.map((w) => {
    const row: Record<string, number | string> = { week: w };
    for (const t of tiers) row[t] = round1(people.filter((p) => p.tier === t).reduce((s, p) => s + hoursInWeek(p.id, w), 0));
    return row as { week: string } & Partial<Record<Tier, number>>;
  });

  // ---- Office vs home ----
  const toHours = (t: LocationTotals): LocationTotals => ({ office: round1(t.office / HOUR), home: round1(t.home / HOUR), unspecified: round1(t.unspecified / HOUR) });
  const totalsOf = (rows: Data["hours"]) => {
    const t = emptyLocationTotals();
    for (const r of rows) t[r.location ?? "unspecified"] += r.ms;
    return t;
  };
  const locationByWeek = weeks.map((w) => ({ week: w, ...toHours(totalsOf((hoursByWeek.get(w) ?? []).filter((r) => ids.has(r.memberId)))) }));
  const locationByTier = tiers.map((t) => {
    const tierIds = new Set(people.filter((p) => p.tier === t).map((p) => p.id));
    return { tier: t, ...toHours(totalsOf(weeks.flatMap((w) => (hoursByWeek.get(w) ?? []).filter((r) => tierIds.has(r.memberId))))) };
  });

  // ---- Attendance ----
  const rowOf = new Map(d.attendance.map((a) => [`${a.meetingId}:${a.memberId}`, a]));
  // Lookups instead of scanning every invite for every member and meeting.
  const inviteKeys = new Set(d.invites.map((i) => `${i.meetingId}:${i.memberId}`));
  const invitesOf = new Map<number, number[]>();
  for (const i of d.invites) invitesOf.set(i.meetingId, [...(invitesOf.get(i.meetingId) ?? []), i.memberId]);
  const isInvited = (meetingId: number, memberId: number) => inviteKeys.has(`${meetingId}:${memberId}`);
  const meetingById = new Map(d.meetings.map((m) => [m.id, m]));
  const invitedTo = (meetingId: number) => (invitesOf.get(meetingId) ?? []).filter((id) => ids.has(id));
  // A late notice counts as unexcused until an admin accepts it.
  const effective = (m: Data["meetings"][number], memberId: number) => {
    const a = rowOf.get(`${m.id}:${memberId}`);
    return effectiveState(a?.state, m, now, a ? { lateNotice: !!a.lateNotice, lateDecision: a.lateDecision ?? null } : null);
  };
  const past = (m: Data["meetings"][number]) => m.endsAt <= now;

  const series = [...new Set(meetingsShown.map((m) => m.series))].sort();
  const attendanceBySeries = series
    .map((s) => {
      const states = meetingsShown.filter((m) => m.series === s && past(m) && m.startsAt >= rangeFrom).flatMap((m) => invitedTo(m.id).map((id) => effective(m, id)));
      const sum = attendanceSummary(states);
      return { series: s, rate: sum.rate, attended: sum.attended, total: sum.total };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));

  // Heatmap: the last 10 past meetings in range, members invited to at least one of them.
  const heatMeetings = meetingsShown
    .filter((m) => past(m) && m.startsAt >= rangeFrom)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(-10);
  const heatRows = people
    .map((p) => ({
      memberId: p.id,
      name: p.name,
      cells: heatMeetings.map((m) => (isInvited(m.id, p.id) ? effective(m, p.id) : null)),
    }))
    .filter((r) => r.cells.some((c) => c !== null));
  const heatmap = { meetings: heatMeetings.map((m) => ({ id: m.id, title: m.title, series: m.series, startsAt: m.startsAt })), rows: heatRows };

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const attendance30 = attendanceSummary(meetingsShown.filter((m) => past(m) && m.startsAt >= thirtyDaysAgo).flatMap((m) => invitedTo(m.id).map((id) => effective(m, id))));

  // ---- Tasks ----
  const finished = d.tasks
    .filter((t) => t.status === "done" && t.completedAt && !t.deletedAt && (!t.createdByAi || t.aiConfirmedAt))
    .map((t) => ({ at: t.completedAt!, assigneeId: t.assigneeId }));
  const inPeople = (assigneeId: number | null) => assigneeId !== null && ids.has(assigneeId);

  const finishedPerMember = people
    .map((p) => ({ memberId: p.id, name: p.name, n: finished.filter((x) => x.assigneeId === p.id && x.at >= rangeFrom).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const anyAi = d.anyAiTask;
  const tasksPerWeek = weeks.map((w) => {
    const { from, to } = weekBounds(w);
    const inWeek = (at: Date) => at >= from && at < to;
    const created = d.tasks.filter((t) => !t.deletedAt && inWeek(t.createdAt) && (!f.tier || inPeople(t.assigneeId)));
    return {
      week: w,
      created: created.filter((t) => !t.createdByAi).length,
      ...(anyAi && { aiCreated: created.filter((t) => t.createdByAi).length }),
      finished: finished.filter((x) => inWeek(x.at) && (!f.tier || inPeople(x.assigneeId))).length,
    };
  });

  // ---- Tiles ----
  const activeIds = new Set<number>();
  for (const p of people) if (hoursInWeek(p.id, thisWeek) > 0) activeIds.add(p.id);
  for (const a of d.attendance) {
    const m = meetingById.get(a.meetingId);
    if (m && m.startsAt >= weekFrom && m.startsAt < weekTo && (a.state === "present" || a.state === "remote") && ids.has(a.memberId)) activeIds.add(a.memberId);
  }
  for (const t of d.taskActivity) if (t.at >= weekFrom && t.at < weekTo && ids.has(t.memberId)) activeIds.add(t.memberId);

  const tiles = {
    active: { n: activeIds.size, of: people.length },
    atTarget: { n: hoursThisWeek.filter((h) => h.onTrack).length, of: people.length },
    attendance30: { rate: attendance30.rate, attended: attendance30.attended, total: attendance30.total },
    finishedThisWeek: finished.filter((x) => x.at >= weekFrom && x.at < weekTo && (!f.tier || inPeople(x.assigneeId))).length,
  };

  // ---- Drifting members ----
  const lastFourWeeks = [1, 2, 3, 4].map((i) => addDays(thisWeek, -7 * i));
  const drifting = people
    .map((p) => {
      const reasons: string[] = [];
      const pcts = lastFourWeeks.map((w) => (p.weeklyHours ? hoursInWeek(p.id, w) / p.weeklyHours : 1));
      const low = pcts.filter((x) => x < 0.5).length;
      if (low >= 2) reasons.push(`Under 50% of their ${p.weeklyHours} h target in ${low} of the last 4 weeks (average ${Math.round((pcts.reduce((a, b) => a + b, 0) / 4) * 100)}%)`);
      const lastSix = d.meetings
        .filter((m) => m.status === "confirmed" && past(m) && isInvited(m.id, p.id))
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
        .slice(0, 6);
      const unexcused = lastSix.filter((m) => effective(m, p.id) === "unexcused").length;
      if (unexcused >= 2) reasons.push(`${unexcused} unexcused absences in their last ${lastSix.length} meetings`);
      return { memberId: p.id, name: p.name, tier: p.tier, reasons };
    })
    .filter((r) => r.reasons.length);

  const allSeries = [...new Set(d.meetings.filter((m) => m.status === "confirmed").map((m) => m.series))].sort();
  return { weeks, tiers, tiles, hoursThisWeek, hoursByTier, locationByWeek, locationByTier, attendanceBySeries, heatmap, finishedPerMember, tasksPerWeek, anyAi, drifting, allSeries };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type { Pace };
