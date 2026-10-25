// Sends task deadline reminders by email. Runs with the meeting reminders (the /api/cron/reminders
// route, or `npm run reminders -- --watch` locally); each run sends whatever is due and records it in
// task_reminders, so nothing is sent twice. Who: the assignee, or everyone in the department for a task
// delegated to a whole department. Members choose the days (reminder_settings.task_days_before) or turn
// them off. Never for finished, deleted or unconfirmed AI tasks, or tasks whose row was deleted in the sheet.
// Like the meeting reminders: claim in a short transaction, send after it, then mark sent or failed
// (see lib/meetings/reminders.ts); no network traffic inside a database transaction.
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, memberDepartments, members, projects, reminderSettings, taskReminders, tasks } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { addDays } from "@/lib/hours/time";
import { deliver, emptyRun, MAX_EMAILS_PER_RUN, PENDING_RETRY_MS, type Claimed, type ReminderRun, type RunOptions } from "@/lib/reminder-delivery";
import { DEFAULT_TASK_REMINDER_DAYS, TASK_REMINDER_OPTIONS } from "./constants";
import { dueTaskReminders, taskReminderEmail } from "./reminder-rules";
import { todayInLjubljana } from "./sheet-mapping";

const LONGEST_DAYS = Math.max(...TASK_REMINDER_OPTIONS.map((o) => o.days));

export async function sendDueTaskReminders(now = new Date(), options: RunOptions = {}): Promise<ReminderRun> {
  const result = emptyRun();
  const maxEmails = options.maxEmails ?? MAX_EMAILS_PER_RUN;
  const staleBefore = new Date(now.getTime() - PENDING_RETRY_MS);
  const claimed: Claimed[] = [];
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
    // Handled: sent or failed, or claimed by a run that is still working. A stale pending row is due again.
    const handledFor = (taskId: number, memberId: number, dueDate: string) =>
      handled
        .filter((h) => h.taskId === taskId && h.memberId === memberId && h.dueDate === dueDate && !(h.status === "pending" && h.claimedAt < staleBefore))
        .map((h) => h.daysBefore);

    for (const r of rows) {
      const dueDate = r.dueDate!;
      if (r.enabled === false) continue;
      const due = dueTaskReminders(dueDate, r.daysBefore ?? DEFAULT_TASK_REMINDER_DAYS, handledFor(r.id, r.memberId, dueDate), now);
      if (!due.length) continue;

      if (claimed.length >= maxEmails) {
        result.deferred++; // left for the next run
        continue;
      }
      // One email covers every reminder that is due now (several only when the due date was set late).
      const mail = taskReminderEmail({ ...r, dueDate }, r.name, `${appUrl()}/tasks/${r.id}`, now);
      await tx
        .insert(taskReminders)
        .values(due.map((daysBefore) => ({ taskId: r.id, memberId: r.memberId, dueDate, daysBefore, status: "pending" as const, claimedAt: now })))
        .onConflictDoUpdate({
          target: [taskReminders.taskId, taskReminders.memberId, taskReminders.dueDate, taskReminders.daysBefore],
          set: { claimedAt: now },
          setWhere: and(eq(taskReminders.status, "pending"), lt(taskReminders.claimedAt, staleBefore)),
        });
      const mine = and(eq(taskReminders.taskId, r.id), eq(taskReminders.memberId, r.memberId), eq(taskReminders.dueDate, dueDate), inArray(taskReminders.daysBefore, due));
      claimed.push({
        mail: { memberId: r.memberId, to: r.email, ...mail },
        finish: async (sent) => {
          await db.update(taskReminders).set({ status: sent.status === "failed" ? "failed" : "sent", emailId: sent.id }).where(mine);
        },
        release: async () => {
          await db.delete(taskReminders).where(and(mine, eq(taskReminders.status, "pending")));
        },
      });
    }
  });
  // The transaction is over: nothing below holds a database connection while waiting for the mail server.
  await deliver(claimed, result, options);
  return result;
}
