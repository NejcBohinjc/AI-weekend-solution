// Scheduled job, called every 5 minutes by a scheduler (Vercel Cron, cron-job.org, ...) with
// "Authorization: Bearer <CRON_SECRET>". Sends the meeting reminders and task deadline reminders that are
// due, and pulls meetings from MEETINGS_ICS_URL when the last pull is older than 15 minutes.
//
// It has a time budget well below the function limit (maxDuration): the sending stops at the deadline and
// leaves the rest for the next run; a run that finds another one busy (the advisory lock) does nothing;
// the calendar pull happens after the response. Emails are sent outside database transactions, with SMTP
// timeouts (see lib/reminder-delivery.ts), so a slow mail server cannot hold the pages up.
import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { syncCalendarIfStale } from "@/lib/meetings/import";
import { sendDueReminders } from "@/lib/meetings/reminders";
import { sendDueTaskReminders } from "@/lib/tasks/reminders";

export const dynamic = "force-dynamic";
/** Function limit in seconds (Vercel). The send budget below is well inside it. */
export const maxDuration = 60;
const SEND_BUDGET_MS = 40_000;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deadline = Date.now() + SEND_BUDGET_MS;
  const reminders = await sendDueReminders(new Date(), { deadline });
  const taskReminders = await sendDueTaskReminders(new Date(), { deadline });
  // Not time-critical, and it can take a while: after the response (it still has the rest of maxDuration).
  after(async () => {
    try {
      const calendar = await syncCalendarIfStale();
      if (calendar && !calendar.ok) console.error("[calendar sync]", calendar.error);
    } catch (err) {
      console.error("[calendar sync]", (err as Error).message);
    }
  });
  return NextResponse.json({
    busy: !reminders.ran && !taskReminders.ran,
    reminders,
    taskReminders,
    calendar: "pulled after the response when due",
  });
}
