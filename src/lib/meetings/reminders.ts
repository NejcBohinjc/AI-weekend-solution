// Sends meeting reminders by email. Run it every few minutes (the /api/cron/reminders route, or
// `npm run reminders -- --watch` locally); each run sends whatever is due and records it in
// meeting_reminders, so nothing is sent twice. Members choose their reminders (reminder_settings);
// nobody is reminded of a meeting they already sent an excuse for.
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, meetingInvites, meetingReminders, meetings, members, reminderSettings } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { DEFAULT_REMINDER_MINUTES, REMINDER_OPTIONS } from "./constants";
import { dueReminders, reminderEmail } from "./rules";

const LONGEST_MS = Math.max(...REMINDER_OPTIONS.map((o) => o.minutes)) * 60_000;

export type ReminderRun = { ran: boolean; emails: number; sent: number; logged: number; failed: number };

export async function sendDueReminders(now = new Date()): Promise<ReminderRun> {
  const result: ReminderRun = { ran: false, emails: 0, sent: 0, logged: 0, failed: 0 };
  await db.transaction(async (tx) => {
    // Only one run at a time; a run that finds another one busy simply does nothing.
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('meeting_reminders')) as locked`);
    if (!locked) return;
    result.ran = true;

    const rows = await tx
      .select({
        meeting: meetings,
        memberId: members.id,
        name: members.name,
        email: members.email,
        enabled: reminderSettings.emailEnabled,
        minutesBefore: reminderSettings.minutesBefore,
        state: attendance.state,
      })
      .from(meetingInvites)
      .innerJoin(meetings, eq(meetingInvites.meetingId, meetings.id))
      .innerJoin(members, and(eq(meetingInvites.memberId, members.id), eq(members.active, true)))
      .leftJoin(reminderSettings, eq(reminderSettings.memberId, members.id))
      .leftJoin(attendance, and(eq(attendance.meetingId, meetings.id), eq(attendance.memberId, members.id)))
      .where(and(eq(meetings.status, "confirmed"), gt(meetings.startsAt, now), lte(meetings.startsAt, new Date(now.getTime() + LONGEST_MS))));
    if (!rows.length) return;

    const handled = await tx
      .select()
      .from(meetingReminders)
      .where(inArray(meetingReminders.meetingId, [...new Set(rows.map((r) => r.meeting.id))]));
    const handledFor = (meetingId: number, memberId: number) =>
      handled.filter((h) => h.meetingId === meetingId && h.memberId === memberId).map((h) => h.minutesBefore);

    for (const r of rows) {
      if (r.enabled === false || r.state === "excused") continue;
      const due = dueReminders(r.meeting.startsAt, r.minutesBefore ?? DEFAULT_REMINDER_MINUTES, handledFor(r.meeting.id, r.memberId), now);
      if (!due.length) continue;

      // One email covers every reminder that is due now (several are due at once only for a late import).
      const mail = reminderEmail(r.meeting, r.name, `${appUrl()}/meetings/${r.meeting.id}`, now);
      const sent = await sendEmail({ memberId: r.memberId, to: r.email, ...mail });
      await tx
        .insert(meetingReminders)
        .values(due.map((minutesBefore) => ({ meetingId: r.meeting.id, memberId: r.memberId, minutesBefore, emailId: sent.id })))
        .onConflictDoNothing();
      result.emails++;
      result[sent.status]++;
    }
  });
  return result;
}
