import { aliasedTable, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { AiBadge, DueDate, StatusBadge, TypeBadge } from "@/components/task-badges";
import { secondaryButtonClass } from "@/components/ui";
import { db } from "@/db";
import { meetings, members, taskEvents, tasks } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { FIELD_LABELS } from "@/lib/tasks/constants";
import { canConfirmAiTask, canDeleteAiTask, canEditTask } from "@/lib/tasks/permissions";
import { sheetState } from "@/lib/tasks/sheet-state";
import { activeMembers } from "@/lib/tasks/queries";
import { normalizeType, todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { runTasksSyncQuietly } from "@/lib/tasks/sheet-sync";
import { tasksSyncStatus } from "@/lib/tasks/sync-status";
import { confirmAiTaskAction, deleteAiTaskAction, updateTaskAction } from "../actions";
import { DoneToggle } from "../done-toggle";
import { SyncStatus } from "../sync-status";
import { TaskForm } from "../task-form";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [me, { id: rawId }, { created }] = await Promise.all([requireMember(), params, searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  after(runTasksSyncQuietly);

  const actor = aliasedTable(members, "actor");
  const creator = aliasedTable(members, "creator");
  const triggerer = aliasedTable(members, "triggerer");
  const [[row], events, memberList, syncStatus] = await Promise.all([
    db
      .select({
        task: tasks,
        assigneeName: members.name,
        creatorName: creator.name,
        triggeredByName: triggerer.name,
        meeting: { id: meetings.id, title: meetings.title, startsAt: meetings.startsAt },
      })
      .from(tasks)
      .leftJoin(members, eq(tasks.assigneeId, members.id))
      .leftJoin(creator, eq(tasks.createdById, creator.id))
      .leftJoin(triggerer, eq(tasks.triggeredById, triggerer.id))
      .leftJoin(meetings, eq(tasks.sourceMeetingId, meetings.id))
      .where(eq(tasks.id, id))
      .limit(1),
    db
      .select({ event: taskEvents, actorName: actor.name })
      .from(taskEvents)
      .leftJoin(actor, eq(taskEvents.actorId, actor.id))
      .where(eq(taskEvents.taskId, id))
      .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id)),
    activeMembers(),
    tasksSyncStatus(),
  ]);
  if (!row || row.task.deletedAt) notFound();
  const { task } = row;
  const editable = canEditTask(me, task);
  const inSheet = sheetState(task);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const fieldLabel = (f: string | null) => FIELD_LABELS[f as keyof typeof FIELD_LABELS] ?? f;

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/tasks" className="text-sm text-subtle hover:text-fg">
            ← Tasks
          </Link>
          <SyncStatus initial={syncStatus} awaitSync={inSheet === "pending"} hideError={inSheet === "pending"} />
        </div>
        {created && (
          <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success">
            Task created.
          </p>
        )}
        {inSheet === "pending" && (
          <p
            role={syncStatus.ok === false ? "alert" : "status"}
            className={`rounded-xl px-4 py-3 text-sm ${syncStatus.ok === false ? "bg-danger-bg text-danger" : "bg-surface-3 text-fg-2"}`}
            data-testid="sheet-state"
          >
            {syncStatus.ok === false && syncStatus.error
              ? `Not in the Google Sheet yet: the last sync failed (${syncStatus.error}). It is retried automatically; you can also press Sync now.`
              : "Not in the Google Sheet yet. It is being written now."}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={task.status} />
          {task.createdByAi && <AiBadge confirmed={!!task.aiConfirmedAt} />}
          {task.type && <TypeBadge type={task.type} />}
          {task.dueDate && <DueDate date={task.dueDate} today={todayInLjubljana()} done={task.status === "done"} />}
          <span className="text-muted">{row.assigneeName ?? "Unassigned"}</span>
          {row.creatorName && <span className="text-xs text-subtle">created by {row.creatorName}</span>}
          {inSheet === "removed" && <span className="text-xs text-warning">no longer in the sheet (its row was deleted there)</span>}
        </p>
        {task.createdByAi && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-violet-line bg-violet-bg p-4 text-sm text-fg-2" data-testid="ai-provenance">
            <p>
              <span className="font-semibold text-violet">Created by AI</span> from{" "}
              {row.meeting?.id ? (
                <Link href={`/meetings/${row.meeting.id}`} className="font-medium text-link underline underline-offset-2">
                  {row.meeting.title}
                </Link>
              ) : (
                "a meeting"
              )}
              {row.meeting?.startsAt && ` on ${row.meeting.startsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIMEZONE })}`}
              {row.triggeredByName && `, triggered by ${row.triggeredByName}`}.
              {task.aiConfirmedAt && " Confirmed by the assignee."}
            </p>
            {task.sourceQuote && (
              <blockquote className="border-l-2 border-violet-line pl-3 italic text-muted">“{task.sourceQuote}”</blockquote>
            )}
          </div>
        )}
        {(canConfirmAiTask(me, task) || (task.createdByAi && !task.aiConfirmedAt && canDeleteAiTask(me, task))) && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-4" data-testid="ai-review">
            <p className="w-full text-sm font-semibold">Review this AI-created task</p>
            <p className="w-full text-sm text-muted">Check the title, person and date. Confirm it, change it below (or hand it to someone else), or delete it.</p>
            {canConfirmAiTask(me, task) && (
              <form action={confirmAiTaskAction.bind(null, task.id)}>
                <button type="submit" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
                  Confirm
                </button>
              </form>
            )}
            <form action={deleteAiTaskAction.bind(null, task.id)}>
              <button type="submit" className={`${secondaryButtonClass} text-danger`}>
                Delete
              </button>
            </form>
          </div>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-3">
            <DoneToggle taskId={task.id} title={task.title} done={task.status === "done"} variant="button" />
            {task.status === "done" && task.completedAt && (
              <span className="text-xs text-subtle">Done on {fmt(task.completedAt)}</span>
            )}
          </div>
        )}
      </div>

      {me.isAdmin && (task.statusRaw || task.assigneeRaw || task.deadlineRaw) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-line bg-surface p-4 text-sm">
          <dt className="col-span-2 mb-1 font-semibold">
            In the sheet{task.sheetRow ? `, row ${task.sheetRow}` : ""} <span className="font-normal text-subtle">· as last read · admins only</span>
          </dt>
          <dt className="text-subtle">status</dt>
          <dd>{task.statusRaw ?? "—"}</dd>
          <dt className="text-subtle">nosilec</dt>
          <dd>{task.assigneeRaw ?? "—"}</dd>
          <dt className="text-subtle">tip taska</dt>
          <dd>{task.typeRaw ?? "—"}</dd>
          <dt className="text-subtle">deadline</dt>
          <dd>{task.deadlineRaw ?? "—"}</dd>
        </dl>
      )}

      {editable ? (
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold">Edit or hand over</h2>
          <TaskForm
            action={updateTaskAction.bind(null, task.id)}
            initial={{
              title: task.title,
              status: task.status,
              assigneeId: task.assigneeId ? String(task.assigneeId) : "",
              // "marketing" from the sheet shows as the list's "Marketing"; other values stay as they are.
              type: normalizeType(task.type) ?? "",
              dueDate: task.dueDate ?? "",
            }}
            members={memberList}
            submitLabel="Save task"
          />
        </div>
      ) : (
        <p className="text-sm text-subtle">Only the assignee, the person who created it, or an admin can change this task.</p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">History</h2>
        <ol className="flex flex-col gap-2 border-l-2 border-line pl-4 text-sm" data-testid="task-history">
          {events.map(({ event: e, actorName }) => (
            <li key={e.id}>
              <span className="text-subtle">{fmt(e.createdAt)} · </span>
              <span className="font-medium">
                {e.source === "sheet_sync"
                  ? `Sheet sync${actorName ? ` (${actorName})` : ""}`
                  : e.source === "ai"
                    ? `AI${actorName ? ` (triggered by ${actorName})` : ""}`
                    : actorName}
              </span>
              {e.source === "ai" && (
                <>
                  {" "}
                  <AiBadge confirmed={false} />
                </>
              )}
              {": "}
              {e.kind === "created" || e.kind === "confirmed" || e.kind === "deleted"
                ? e.newValue
                : e.kind === "reopened"
                  ? `Reopened (${e.oldValue ?? "Done"} → ${e.newValue ?? "empty"})`
                  : e.kind === "conflict"
                  ? `${fieldLabel(e.field)} was changed in the sheet to “${e.oldValue ?? "empty"}” and here to “${e.newValue ?? "empty"}”; kept “${e.newValue ?? "empty"}”`
                  : `${fieldLabel(e.field)}: ${e.oldValue ?? "empty"} → ${e.newValue ?? "empty"}`}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
