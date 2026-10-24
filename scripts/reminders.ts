// Sends due meeting reminders from the command line, for local development or a server with cron.
//   npm run reminders              one run
//   npm run reminders -- --watch   every minute until stopped (Ctrl+C)
import "dotenv/config";
import { importFromCalendarUrlIfStale } from "../src/lib/meetings/import";
import { sendDueReminders } from "../src/lib/meetings/reminders";

async function runOnce() {
  const calendar = await importFromCalendarUrlIfStale(60);
  if (calendar) console.log(`calendar: ${calendar.ok ? `${calendar.meetings} meetings` : calendar.error}`);
  const r = await sendDueReminders();
  const time = new Date().toLocaleTimeString("en-GB");
  console.log(r.ran ? `${time} reminders: ${r.emails} emails (${r.sent} sent, ${r.logged} logged, ${r.failed} failed)` : `${time} another run is busy`);
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
