// Attendance and reminder rules. Pure (no I/O), so it is unit-tested (rules.test.ts).
import { TIMEZONE } from "@/lib/app";
import { ljubljanaParts } from "@/lib/hours/time";
import { escapeHtml } from "@/lib/html";
import {
  CHECKIN_CLOSES_MINUTES,
  CHECKIN_OPENS_MINUTES,
  EXCUSE_HOURS_AFTER_END,
  type AttendanceState,
} from "./constants";

const MIN = 60_000;

type Times = { startsAt: Date; endsAt: Date };

/** upcoming: before check-in opens. open: members can check in now. past: check-in has closed. */
export type Phase = "upcoming" | "open" | "past";

export function meetingPhase(m: Times, now: Date): Phase {
  if (now.getTime() < m.startsAt.getTime() - CHECKIN_OPENS_MINUTES * MIN) return "upcoming";
  if (now.getTime() <= m.endsAt.getTime() + CHECKIN_CLOSES_MINUTES * MIN) return "open";
  return "past";
}

/**
 * What a member's attendance counts as: what they (or an admin) recorded, or, once check-in has
 * closed without anything recorded, "unexcused". Null means nothing yet and nothing missed.
 */
export function effectiveState(recorded: AttendanceState | null | undefined, m: Times, now: Date): AttendanceState | null {
  if (recorded) return recorded;
  return meetingPhase(m, now) === "past" ? "unexcused" : null;
}

/** What a member may do for one of their meetings. Admins can always change anything. */
export function memberActions(m: Times & { cancelled: boolean }, now: Date): { checkIn: boolean; excuse: boolean } {
  if (m.cancelled) return { checkIn: false, excuse: false };
  return {
    checkIn: meetingPhase(m, now) === "open",
    excuse: now.getTime() <= m.endsAt.getTime() + EXCUSE_HOURS_AFTER_END * 60 * MIN,
  };
}

// ---------- Reminders ----------

/**
 * Reminders due now: each chosen "minutes before" whose moment has passed while the meeting has not
 * started yet, and that was not handled before. A meeting imported late gets its overdue reminders
 * now (the caller sends one email for all of them), never after it started.
 */
export function dueReminders(startsAt: Date, minutesBefore: number[], handled: number[], now: Date): number[] {
  if (now >= startsAt) return [];
  return minutesBefore.filter((m) => !handled.includes(m) && startsAt.getTime() - m * MIN <= now.getTime()).sort((a, b) => a - b);
}

/** "in 10 minutes", "in 3 hours", "today at 18:00", "tomorrow at 18:00", "on Mon 2 Nov at 18:00" */
export function whenPhrase(startsAt: Date, now: Date): string {
  const minutes = Math.round((startsAt.getTime() - now.getTime()) / MIN);
  if (minutes < 60) return `in ${Math.max(1, minutes)} ${minutes === 1 ? "minute" : "minutes"}`;
  const at = ljubljanaParts(startsAt);
  const today = ljubljanaParts(now).date;
  if (minutes < 6 * 60 && at.date === today) {
    const h = Math.round(minutes / 60);
    return `in ${h} ${h === 1 ? "hour" : "hours"}`;
  }
  if (at.date === today) return `today at ${at.time}`;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (at.date === tomorrow.toISOString().slice(0, 10)) return `tomorrow at ${at.time}`;
  const day = startsAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE });
  return `on ${day} at ${at.time}`;
}

export type ReminderEmail = { subject: string; text: string; html: string };


/** The reminder email for one meeting. `url` opens the meeting in the app (to check in or send an excuse). */
export function reminderEmail(
  m: Times & { title: string; series: string; location: string | null },
  memberName: string,
  url: string,
  now: Date,
): ReminderEmail {
  const when = whenPhrase(m.startsAt, now);
  const s = ljubljanaParts(m.startsAt);
  const e = ljubljanaParts(m.endsAt);
  const day = m.startsAt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE });
  const time = `${day}, ${s.time}–${e.time}`;
  const firstName = memberName.split(" ")[0];
  const lines = [
    `Hi ${firstName},`,
    "",
    `${m.title} (${m.series}) starts ${when}.`,
    "",
    `When: ${time}`,
    ...(m.location ? [`Where: ${m.location}`] : []),
    "",
    `Can't come? Send an excuse, or check in when you arrive: ${url}`,
    "",
    "You get this because you are invited in the calendar. Choose which reminders you get on the Meetings page.",
  ];
  const html = `<p>Hi ${escapeHtml(firstName)},</p>
<p><strong>${escapeHtml(m.title)}</strong> (${escapeHtml(m.series)}) starts ${escapeHtml(when)}.</p>
<p>When: ${escapeHtml(time)}${m.location ? `<br>Where: ${escapeHtml(m.location)}` : ""}</p>
<p><a href="${escapeHtml(url)}">Open the meeting</a> to send an excuse, or to check in when you arrive.</p>
<p style="color:#64748b;font-size:12px">You get this because you are invited in the calendar. Choose which reminders you get on the Meetings page.</p>`;
  return { subject: `Reminder: ${m.title} ${when}`, text: lines.join("\n"), html };
}

// ---------- Summaries ----------

/** Counts per state, with "attended" = present + remote, over meetings that count (not cancelled, not upcoming). */
export function attendanceSummary(states: (AttendanceState | null)[]) {
  const counts = { present: 0, remote: 0, excused: 0, unexcused: 0 };
  for (const s of states) if (s) counts[s]++;
  const total = counts.present + counts.remote + counts.excused + counts.unexcused;
  const attended = counts.present + counts.remote;
  return { ...counts, total, attended, rate: total ? Math.round((attended / total) * 100) : null };
}
