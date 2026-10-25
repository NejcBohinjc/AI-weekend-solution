// Scheduled job, called every 5 minutes by a scheduler (Vercel Cron, cron-job.org, ...) with
// "Authorization: Bearer <CRON_SECRET>". Sends the meeting reminders and task deadline reminders that are
// due, pulls meetings from MEETINGS_ICS_URL when the last pull is older than 15 minutes, and keeps the
// Slack meeting announcements in step (only with SLACK_BOT_TOKEN).
//
// Only the reminders are done before the response. They have a time budget well below the function limit
// (maxDuration): the sending stops at the deadline and leaves the rest for the next run; a run that finds
// another one busy (the advisory lock) does nothing. Emails are sent outside database transactions, with
// SMTP timeouts (see lib/reminder-delivery.ts), so a slow mail server cannot hold the pages up. The
// calendar pull and the Slack sync are not time-critical and can be slow: they run after the response
// (each in its own after(), failures only logged), so they never delay the reminders.
import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { syncCalendarIfStale } from "@/lib/meetings/import";
import { sendDueReminders } from "@/lib/meetings/reminders";
import { slackConfigured } from "@/lib/slack/client";
import { runSlackSync } from "@/lib/slack/announcements";
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
  const slack = slackConfigured();
  if (slack) {
    // Calls the Slack API; runs under its own lease (sync_state), never inside a database transaction.
    after(async () => {
      try {
        await runSlackSync();
      } catch (err) {
        console.error("[slack]", (err as Error).message);
      }
    });
  }
  return NextResponse.json({
    busy: !reminders.ran && !taskReminders.ran,
    reminders,
    taskReminders,
    calendar: "pulled after the response when due",
    slack: slack ? "runs after the response" : "not set up",
  });
}
