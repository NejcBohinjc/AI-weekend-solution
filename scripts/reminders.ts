// Sends due meeting reminders and task deadline reminders from the command line, for local development
// or a server with cron.
//   npm run reminders              one run
//   npm run reminders -- --watch   every minute until stopped (Ctrl+C)
import "dotenv/config";
import { syncCalendarIfStale } from "../src/lib/meetings/import";
import { sendDueReminders, type ReminderRun } from "../src/lib/meetings/reminders";
import { runSlackSync } from "../src/lib/slack/announcements";
import { sendDueTaskReminders } from "../src/lib/tasks/reminders";

const summary = (label: string, r: ReminderRun) =>
  r.ran ? `${label}: ${r.emails} emails (${r.sent} sent, ${r.logged} logged, ${r.failed} failed${r.deferred ? `, ${r.deferred} deferred` : ""})` : `${label}: another run is busy`;

async function runOnce() {
  const calendar = await syncCalendarIfStale();
  if (calendar) console.log(`calendar: ${calendar.ok ? `${calendar.meetings} meetings` : calendar.error}`);
  const meetings = await sendDueReminders();
  const tasks = await sendDueTaskReminders();
  const time = new Date().toLocaleTimeString("en-GB");
  console.log(`${time} ${summary("meeting reminders", meetings)}; ${summary("task reminders", tasks)}`);
  const slack = await runSlackSync();
  if (slack) console.log(`slack: ${slack.scheduled} scheduled, ${slack.rescheduled} rescheduled, ${slack.postedNow} posted, ${slack.cancelled} cancelled${slack.ok ? "" : ` (${slack.error ?? slack.problems.map((p) => p.error).join("; ")})`}`);
}

async function main() {
  await runOnce();
  if (!process.argv.includes("--watch")) process.exit(0);
  setInterval(() => runOnce().catch((err) => console.error(err)), 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
