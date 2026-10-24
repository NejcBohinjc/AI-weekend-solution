// Scheduled job, called every 5 minutes by a scheduler (Vercel Cron, cron-job.org, ...) with
// "Authorization: Bearer <CRON_SECRET>". Pulls meetings from MEETINGS_ICS_URL when the last pull is
// older than 15 minutes, and sends the meeting reminders and task deadline reminders that are due.
import { NextResponse, type NextRequest } from "next/server";
import { syncCalendarIfStale } from "@/lib/meetings/import";
import { sendDueReminders } from "@/lib/meetings/reminders";
import { sendDueTaskReminders } from "@/lib/tasks/reminders";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const calendar = await syncCalendarIfStale();
  const reminders = await sendDueReminders();
  const taskReminders = await sendDueTaskReminders();
  return NextResponse.json({
    calendar: calendar ? { ok: calendar.ok, error: calendar.error, meetings: calendar.meetings } : "not due",
    reminders,
    taskReminders,
  });
}
