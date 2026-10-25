// Task deadline reminder rules. Pure (no I/O), so it is unit-tested (reminder-rules.test.ts).
import { TIMEZONE } from "@/lib/app";
import { addDays, ljubljanaToUtc } from "@/lib/hours/time";
import { escapeHtml } from "@/lib/html";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_REMINDER_TIME, type TaskPriority, type TaskStatus } from "./constants";
import { todayInLjubljana } from "./sheet-mapping";

/** When the reminder "daysBefore days before the due date" goes out: TASK_REMINDER_TIME in Ljubljana. */
export function taskReminderAt(dueDate: string, daysBefore: number): Date {
  return ljubljanaToUtc(addDays(dueDate, -daysBefore), TASK_REMINDER_TIME);
}

/**
 * Reminders due now: each chosen "days before" whose moment has passed, not handled before, while the
 * due date has not passed yet. A task that gets a near due date late gets its missed reminders now
 * (the caller sends one email for all of them), never once the due day is over.
 */
export function dueTaskReminders(dueDate: string, daysBefore: number[], handled: number[], now: Date): number[] {
  if (todayInLjubljana(now) > dueDate) return [];
  return daysBefore.filter((d) => !handled.includes(d) && taskReminderAt(dueDate, d) <= now).sort((a, b) => a - b);
}

/** Whole days from today (Ljubljana) to the due date. */
export function daysUntil(dueDate: string, now: Date): number {
  return Math.round((Date.parse(`${dueDate}T12:00:00Z`) - Date.parse(`${todayInLjubljana(now)}T12:00:00Z`)) / 86_400_000);
}

/** "today", "tomorrow", "in 3 days". */
export function dueWhen(dueDate: string, now: Date): string {
  const days = daysUntil(dueDate, now);
  if (days <= 0) return "today";
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export type TaskForReminder = {
  title: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  projectName: string | null;
  departmentName: string | null; // set when the task is delegated to a whole department
};

/** The reminder email for one task. `url` opens the task in the app (to finish, reschedule or hand it over). */
export function taskReminderEmail(t: TaskForReminder, memberName: string, url: string, now: Date) {
  const when = dueWhen(t.dueDate, now);
  const day = new Date(`${t.dueDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE });
  const firstName = memberName.split(" ")[0];
  const details = [`Priority: ${PRIORITY_LABELS[t.priority]}`, `Status: ${STATUS_LABELS[t.status]}`, ...(t.projectName ? [`Project: ${t.projectName}`] : [])].join(" · ");
  const department = t.departmentName ? `It is delegated to the ${t.departmentName} department: anyone in it can take it.` : null;
  const why = `You get this because the task is ${t.departmentName ? "your department's" : "yours"}. Choose your deadline reminders on the Tasks page.`;
  const lines = [
    `Hi ${firstName},`,
    "",
    `"${t.title}" is due ${when} (${day}).`,
    details,
    ...(department ? [department] : []),
    "",
    `Finish it, change the date or hand it over: ${url}`,
    "",
    why,
  ];
  const html = `<p>Hi ${escapeHtml(firstName)},</p>
<p><strong>${escapeHtml(t.title)}</strong> is due ${escapeHtml(when)} (${escapeHtml(day)}).<br>${escapeHtml(details)}</p>
${department ? `<p>${escapeHtml(department)}</p>\n` : ""}<p><a href="${escapeHtml(url)}">Open the task</a> to finish it, change the date or hand it over.</p>
<p style="color:#64748b;font-size:12px">${escapeHtml(why)}</p>`;
  const subject = `${t.priority === "urgent" ? "Urgent, due" : "Due"} ${when}: ${t.title}`;
  return { subject, text: lines.join("\n"), html };
}
