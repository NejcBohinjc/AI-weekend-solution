// Sends meeting reminders by email. Run it every few minutes (the /api/cron/reminders route, or
// `npm run reminders -- --watch` locally); each run sends whatever is due and records it in
// meeting_reminders, so nothing is sent twice. Members choose their reminders (reminder_settings);
// nobody is reminded of a meeting they already sent an excuse for.
//
// Three steps, so no network traffic happens inside a database transaction: (1) a short transaction takes
// the lock, finds what is due and claims it (reminder rows inserted as "pending"); (2) the emails are sent
// after the commit, with timeouts and a time budget; (3) each row is marked sent or failed. A pending row
// older than 10 minutes (a run that died) is claimed again.
import { and, eq, gt, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, meetingInvites, meetingReminders, meetings, members, reminderSettings } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { deliver, emptyRun, MAX_EMAILS_PER_RUN, PENDING_RETRY_MS, type Claimed, type ReminderRun, type RunOptions } from "@/lib/reminder-delivery";
import { DEFAULT_REMINDER_MINUTES, REMINDER_OPTIONS } from "./constants";
import { dueReminders, reminderEmail } from "./rules";

export type { ReminderRun };

const LONGEST_MS = Math.max(...REMINDER_OPTIONS.map((o) => o.minutes)) * 60_000;

export async function sendDueReminders(now = new Date(), options: RunOptions = {}): Promise<ReminderRun> {
  const result = emptyRun();
  const maxEmails = options.maxEmails ?? MAX_EMAILS_PER_RUN;
  const staleBefore = new Date(now.getTime() - PENDING_RETRY_MS);
  const claimed: Claimed[] = [];

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
    // Handled: sent or failed, or claimed by a run that is still working. A stale pending row is due again.
    const handledFor = (meetingId: number, memberId: number) =>
      handled
        .filter((h) => h.meetingId === meetingId && h.memberId === memberId && !(h.status === "pending" && h.claimedAt < staleBefore))
        .map((h) => h.minutesBefore);

    for (const r of rows) {
      if (r.enabled === false || r.state === "excused") continue;
      const due = dueReminders(r.meeting.startsAt, r.minutesBefore ?? DEFAULT_REMINDER_MINUTES, handledFor(r.meeting.id, r.memberId), now);
      if (!due.length) continue;
      if (claimed.length >= maxEmails) {
        result.deferred++; // left for the next run
        continue;
      }

      // One email covers every reminder that is due now (several are due at once only for a late import).
      const mail = reminderEmail(r.meeting, r.name, `${appUrl()}/meetings/${r.meeting.id}`, now);
      await tx
        .insert(meetingReminders)
        .values(due.map((minutesBefore) => ({ meetingId: r.meeting.id, memberId: r.memberId, minutesBefore, status: "pending" as const, claimedAt: now })))
        .onConflictDoUpdate({
          target: [meetingReminders.meetingId, meetingReminders.memberId, meetingReminders.minutesBefore],
          set: { claimedAt: now },
          setWhere: and(eq(meetingReminders.status, "pending"), lt(meetingReminders.claimedAt, staleBefore)),
        });
      const mine = and(eq(meetingReminders.meetingId, r.meeting.id), eq(meetingReminders.memberId, r.memberId), inArray(meetingReminders.minutesBefore, due));
      claimed.push({
        mail: { memberId: r.memberId, to: r.email, ...mail },
        finish: async (sent) => {
          await db.update(meetingReminders).set({ status: sent.status === "failed" ? "failed" : "sent", emailId: sent.id }).where(mine);
        },
        release: async () => {
          await db.delete(meetingReminders).where(and(mine, eq(meetingReminders.status, "pending")));
        },
      });
    }
  });

  // The transaction is over: nothing below holds a database connection while waiting for the mail server.
  await deliver(claimed, result, options);
  return result;
}
