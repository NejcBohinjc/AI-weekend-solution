// Admin analytics, computed from plain rows (loaded in load.ts). Pure, so it is unit-tested
// (compute.test.ts). Definitions match the rest of the app: weekPace() for "on track", effectiveState()
// for attendance (an unanswered past meeting counts as unexcused), attendanceSummary() for rates.
// Unconfirmed AI-created tasks never count towards anyone's numbers. A finished task counts once, at its
// current completion time (tasks.completed_at): reopened tasks drop out, done again counts once.
import type { WorkLocation } from "@/lib/hours/constants";
import { emptyLocationTotals, locationTotals, type LocationTotals } from "@/lib/hours/location";
import { addDays, overlapMs, weekBounds, weekPace, weekStartOf, type Pace } from "@/lib/hours/time";
import type { AttendanceState } from "@/lib/meetings/constants";
import { attendanceSummary, effectiveState } from "@/lib/meetings/rules";
import { TIERS, type Tier } from "@/lib/tiers";

const HOUR = 3_600_000;

export type Range = "4w" | "8w" | "all";
export const RANGES: Record<Range, string> = { "4w": "Last 4 weeks", "8w": "Last 8 weeks", all: "All (up to 26 weeks)" };

export type Data = {
  now: Date;
  members: { id: number; name: string; tier: Tier; weeklyHours: number; active: boolean }[];
  /** location: null for entries from before it was recorded (shown as "unspecified", never guessed). */
  entries: { memberId: number; startedAt: Date; endedAt: Date | null; location?: WorkLocation | null }[];
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
  /** Any task change by a member (for "active"). */
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
  const earliest = Math.min(now.getTime(), ...d.entries.map((e) => e.startedAt.getTime()), ...d.meetings.map((m) => m.startsAt.getTime()));
  const weekCount =
    f.range === "4w" ? 4 : f.range === "8w" ? 8 : Math.min(26, Math.max(1, Math.round((weekFrom.getTime() - weekBounds(weekStartOf(new Date(earliest))).from.getTime()) / (7 * 86_400_000)) + 1));
  const weeks = Array.from({ length: weekCount }, (_, i) => addDays(thisWeek, -7 * (weekCount - 1 - i)));
  const rangeFrom = weekBounds(weeks[0]).from;

  const hoursIn = (memberId: number, from: Date, to: Date) =>
    d.entries.filter((e) => e.memberId === memberId).reduce((sum, e) => sum + overlapMs(e.startedAt, e.endedAt, from, to, now), 0) / HOUR;

  // ---- Hours this week, per member ----
  const hoursThisWeek = people
    .map((p) => {
      const hours = hoursIn(p.id, weekFrom, weekTo);
      const pace = weekPace(hours * HOUR, p.weeklyHours, Math.min(1, weekElapsed));
      return { memberId: p.id, name: p.name, tier: p.tier, hours, target: p.weeklyHours, pct: p.weeklyHours ? hours / p.weeklyHours : 0, pace, onTrack: pace === "met" || pace === "on_track" };
    })
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

  // ---- Hours per week by tier ----
  const tiers = f.tier ? [f.tier] : [...TIERS];
  const hoursByTier = weeks.map((w) => {
    const { from, to } = weekBounds(w);
    const row: Record<string, number | string> = { week: w };
    for (const t of tiers) row[t] = round1(people.filter((p) => p.tier === t).reduce((s, p) => s + hoursIn(p.id, from, to), 0));
    return row as { week: string } & Partial<Record<Tier, number>>;
  });

  // ---- Office vs home ----
  const peopleEntries = d.entries.filter((e) => ids.has(e.memberId)).map((e) => ({ ...e, location: e.location ?? null }));
  const toHours = (t: LocationTotals): LocationTotals => ({ office: round1(t.office / HOUR), home: round1(t.home / HOUR), unspecified: round1(t.unspecified / HOUR) });
  const locationByWeek = weeks.map((w) => {
    const { from, to } = weekBounds(w);
    return { week: w, ...toHours(locationTotals(peopleEntries, from, to, now)) };
  });
  const locationByTier = tiers.map((t) => {
    const tierIds = new Set(people.filter((p) => p.tier === t).map((p) => p.id));
    const own = peopleEntries.filter((e) => tierIds.has(e.memberId));
    return { tier: t, ...toHours(own.length ? locationTotals(own, rangeFrom, weekTo, now) : emptyLocationTotals()) };
  });

  // ---- Attendance ----
  const rowOf = new Map(d.attendance.map((a) => [`${a.meetingId}:${a.memberId}`, a]));
  const invitedTo = (meetingId: number) => d.invites.filter((i) => i.meetingId === meetingId && ids.has(i.memberId)).map((i) => i.memberId);
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
      cells: heatMeetings.map((m) => (d.invites.some((i) => i.meetingId === m.id && i.memberId === p.id) ? effective(m, p.id) : null)),
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

  const anyAi = d.tasks.some((t) => t.createdByAi && !t.deletedAt);
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
  for (const p of people) if (hoursIn(p.id, weekFrom, weekTo) > 0) activeIds.add(p.id);
  for (const a of d.attendance) {
    const m = d.meetings.find((x) => x.id === a.meetingId);
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
      const pcts = lastFourWeeks.map((w) => {
        const { from, to } = weekBounds(w);
        return p.weeklyHours ? hoursIn(p.id, from, to) / p.weeklyHours : 1;
      });
      const low = pcts.filter((x) => x < 0.5).length;
      if (low >= 2) reasons.push(`Under 50% of their ${p.weeklyHours} h target in ${low} of the last 4 weeks (average ${Math.round((pcts.reduce((a, b) => a + b, 0) / 4) * 100)}%)`);
      const lastSix = d.meetings
        .filter((m) => m.status === "confirmed" && past(m) && d.invites.some((i) => i.meetingId === m.id && i.memberId === p.id))
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
