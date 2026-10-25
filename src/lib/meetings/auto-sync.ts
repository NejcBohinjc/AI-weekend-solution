// Keeps meetings in step with Google Calendar without a scheduler: pages that show meetings call this,
// and after the response is sent the calendar is pulled if the last pull is older than 15 minutes.
// The scheduled job (/api/cron/reminders) does the same, so quiet periods are covered too.
// Then the Slack announcements are brought in line with the meetings (only with SLACK_BOT_TOKEN, at
// most every 5 minutes).
import { after } from "next/server";
import { sweepAbsenceFollowUpsQuietly } from "@/lib/general-tasks";
import { runSlackSyncQuietly } from "@/lib/slack/announcements";
import { calendarUrl, syncCalendarIfStale } from "./import";

export function syncCalendarInBackground(): void {
  // Also: ask for general tasks for absences decided before their meeting, once it has ended.
  after(sweepAbsenceFollowUpsQuietly);
  after(async () => {
    if (calendarUrl()) {
      try {
        const report = await syncCalendarIfStale();
        if (report && !report.ok) console.error("[calendar sync]", report.error);
      } catch (err) {
        console.error("[calendar sync]", (err as Error).message);
      }
    }
    await runSlackSyncQuietly();
  });
}
