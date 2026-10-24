// Keeps meetings in step with Google Calendar without a scheduler: pages that show meetings call this,
// and after the response is sent the calendar is pulled if the last pull is older than 15 minutes.
// The scheduled job (/api/cron/reminders) does the same, so quiet periods are covered too.
import { after } from "next/server";
import { calendarUrl, syncCalendarIfStale } from "./import";

export function syncCalendarInBackground(): void {
  if (!calendarUrl()) return;
  after(async () => {
    try {
      const report = await syncCalendarIfStale();
      if (report && !report.ok) console.error("[calendar sync]", report.error);
    } catch (err) {
      console.error("[calendar sync]", (err as Error).message);
    }
  });
}
