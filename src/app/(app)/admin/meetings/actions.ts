"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { importFromCalendarUrl, importIcsText, recordFailedImport, type ImportReport } from "@/lib/meetings/import";
import { sendDueReminders, type ReminderRun } from "@/lib/meetings/reminders";

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

export async function sendRemindersNowAction(_prev: ReminderRun | null): Promise<ReminderRun> {
  await requireAdmin();
  const result = await sendDueReminders();
  refresh();
  return result;
}
