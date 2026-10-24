// Sends task deadline reminders by email. Runs with the meeting reminders (the /api/cron/reminders
// route, or `npm run reminders -- --watch` locally); each run sends whatever is due and records it in
// task_reminders, so nothing is sent twice. Who: the assignee, or everyone in the department for a task
// delegated to a whole department. Members choose the days (reminder_settings.task_days_before) or turn
// them off. Never for finished, deleted or unconfirmed AI tasks, or tasks whose row was deleted in the sheet.
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, memberDepartments, members, projects, reminderSettings, taskReminders, tasks } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { addDays } from "@/lib/hours/time";
import type { ReminderRun } from "@/lib/meetings/reminders";
import { DEFAULT_TASK_REMINDER_DAYS, TASK_REMINDER_OPTIONS } from "./constants";
import { dueTaskReminders, taskReminderEmail } from "./reminder-rules";
import { todayInLjubljana } from "./sheet-mapping";

const LONGEST_DAYS = Math.max(...TASK_REMINDER_OPTIONS.map((o) => o.days));

export async function sendDueTaskReminders(now = new Date()): Promise<ReminderRun> {
  const result: ReminderRun = { ran: false, emails: 0, sent: 0, logged: 0, failed: 0 };
  await db.transaction(async (tx) => {
    // Only one run at a time; a run that finds another one busy simply does nothing.
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('task_reminders')) as locked`);
    if (!locked) return;
    result.ran = true;

    const today = todayInLjubljana(now);
    const open = and(
      ne(tasks.status, "done"),
      isNull(tasks.deletedAt),
      eq(tasks.inSheet, true),
      or(eq(tasks.createdByAi, false), isNotNull(tasks.aiConfirmedAt)),
      gte(tasks.dueDate, today),
      lte(tasks.dueDate, addDays(today, LONGEST_DAYS)),
    );
    const fields = {
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      status: tasks.status,
      projectName: projects.name,
      memberId: members.id,
      name: members.name,
      email: members.email,
      enabled: reminderSettings.taskEmailEnabled,
      daysBefore: reminderSettings.taskDaysBefore,
    };
    const [assigned, delegated] = await Promise.all([
      tx
        .select(fields)
        .from(tasks)
        .innerJoin(members, and(eq(tasks.assigneeId, members.id), eq(members.active, true)))
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(reminderSettings, eq(reminderSettings.memberId, members.id))
        .where(open),
      tx
        .select({ ...fields, departmentName: departments.name })
        .from(tasks)
        .innerJoin(departments, eq(tasks.departmentId, departments.id))
        .innerJoin(memberDepartments, eq(memberDepartments.departmentId, departments.id))
        .innerJoin(members, and(eq(memberDepartments.memberId, members.id), eq(members.active, true)))
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(reminderSettings, eq(reminderSettings.memberId, members.id))
        .where(and(open, isNull(tasks.assigneeId))),
    ]);
    const rows = [...assigned.map((r) => ({ ...r, departmentName: null })), ...delegated];
    if (!rows.length) return;

    const handled = await tx
      .select()
      .from(taskReminders)
      .where(inArray(taskReminders.taskId, [...new Set(rows.map((r) => r.id))]));
    const handledFor = (taskId: number, memberId: number, dueDate: string) =>
      handled.filter((h) => h.taskId === taskId && h.memberId === memberId && h.dueDate === dueDate).map((h) => h.daysBefore);

    for (const r of rows) {
      const dueDate = r.dueDate!;
      if (r.enabled === false) continue;
      const due = dueTaskReminders(dueDate, r.daysBefore ?? DEFAULT_TASK_REMINDER_DAYS, handledFor(r.id, r.memberId, dueDate), now);
      if (!due.length) continue;

      // One email covers every reminder that is due now (several only when the due date was set late).
      const mail = taskReminderEmail({ ...r, dueDate }, r.name, `${appUrl()}/tasks/${r.id}`, now);
      const sent = await sendEmail({ memberId: r.memberId, to: r.email, ...mail });
      await tx
        .insert(taskReminders)
        .values(due.map((daysBefore) => ({ taskId: r.id, memberId: r.memberId, dueDate, daysBefore, emailId: sent.id })))
        .onConflictDoNothing();
      result.emails++;
      result[sent.status]++;
    }
  });
  return result;
}
