// Scheduled job, called every 5 minutes by a scheduler (Vercel Cron, cron-job.org, ...) with
// "Authorization: Bearer <CRON_SECRET>". Refreshes meetings from MEETINGS_ICS_URL (at most hourly)
// and sends the meeting reminders that are due.
import { NextResponse, type NextRequest } from "next/server";
import { importFromCalendarUrlIfStale } from "@/lib/meetings/import";
import { sendDueReminders } from "@/lib/meetings/reminders";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const calendar = await importFromCalendarUrlIfStale(60);
  const reminders = await sendDueReminders();
  return NextResponse.json({
    calendar: calendar ? { ok: calendar.ok, error: calendar.error, meetings: calendar.meetings } : "not due",
    reminders,
  });
}
