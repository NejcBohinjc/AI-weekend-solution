"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { emailSettings, sendTestEmail } from "@/lib/email";
import { importFromCalendarUrl, importIcsText, recordFailedImport, type ImportReport } from "@/lib/meetings/import";
import { sendDueReminders, type ReminderRun } from "@/lib/meetings/reminders";
import { sendDueTaskReminders } from "@/lib/tasks/reminders";

function refresh() {
  revalidatePath("/admin/meetings");
  revalidatePath("/meetings", "layout");
  revalidatePath("/dashboard");
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Imports an .ics file (Google Calendar: Settings → Import & export → Export). */
export async function importIcsFileAction(_prev: ImportReport | null, formData: FormData): Promise<ImportReport> {
  const admin = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return recordFailedImport("file", "Choose an .ics file first.", admin.id);
  if (file.size > MAX_FILE_BYTES) return recordFailedImport("file", "The file is larger than 5 MB.", admin.id);
  const report = await importIcsText(await file.text(), "file", admin.id, formData.get("wholeCalendar") === "on");
  refresh();
  return report;
}

export async function importFromUrlAction(_prev: ImportReport | null): Promise<ImportReport> {
  const admin = await requireAdmin();
  const report = await importFromCalendarUrl(admin.id);
  refresh();
  return report;
}

export type TestEmailResult = { status: "sent" | "logged" | "failed"; to: string; error?: string; sending: boolean };

/** "Send test email": one message to MAIL_REDIRECT_TO (or the admin), so a wrong SMTP setup shows its exact error. */
export async function sendTestEmailAction(_prev: TestEmailResult | null): Promise<TestEmailResult> {
  const admin = await requireAdmin();
  const result = await sendTestEmail(admin);
  refresh();
  return { status: result.status, to: result.to, error: result.error, sending: emailSettings().sending };
}

export async function sendRemindersNowAction(_prev: ReminderRun | null): Promise<ReminderRun> {
  await requireAdmin();
  // Both kinds, like the scheduled job, with the same time budget.
  const deadline = Date.now() + 40_000;
  const result = await sendDueReminders(new Date(), { deadline });
  const tasks = await sendDueTaskReminders(new Date(), { deadline });
  for (const k of ["emails", "sent", "logged", "failed", "deferred"] as const) result[k] += tasks[k];
  result.ran = result.ran || tasks.ran;
  refresh();
  return result;
}
