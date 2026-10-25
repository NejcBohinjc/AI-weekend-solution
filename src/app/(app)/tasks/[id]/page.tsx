import { aliasedTable, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { AiBadge, DepartmentBadge, DueDate, PriorityBadge, StatusBadge, TypeBadge } from "@/components/task-badges";
import { quietLinkClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { db } from "@/db";
import { departments, generalTaskRequests, meetings, members, projects, taskEvents, tasks } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { departmentList } from "@/lib/departments";
import { projectList } from "@/lib/projects/queries";
import { FIELD_LABELS } from "@/lib/tasks/constants";
import { ownerValue } from "@/lib/tasks/owner";
import { canConfirmAiTask, canDeleteAiTask, canEditTask, canTakeTask } from "@/lib/tasks/permissions";
import { sheetState } from "@/lib/tasks/sheet-state";
import { activeMembers } from "@/lib/tasks/queries";
import { normalizeType, todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { runTasksSyncQuietly } from "@/lib/tasks/sheet-sync";
import { tasksSyncStatus } from "@/lib/tasks/sync-status";
import { confirmAiTaskAction, deleteAiTaskAction, takeTaskAction, updateTaskAction } from "../actions";
import { DoneToggle } from "../done-toggle";
import { GeneralTaskDetail } from "./general-detail";
import { SyncStatus } from "../sync-status";
import { TaskForm } from "../task-form";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [{ id: rawId }, { created }] = await Promise.all([params, searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const actor = aliasedTable(members, "actor");
  const creator = aliasedTable(members, "creator");
  const triggerer = aliasedTable(members, "triggerer");
  // The task, its history and the lists for the form only need the id from the URL: they are fetched
  // while the session is checked. Nothing from them is shown before the permission checks below.
  const [me, [row], events, memberList, syncStatus, departmentOptions, projectOptions] = await Promise.all([
    requireMember(),
    db
      .select({
        task: tasks,
        assigneeName: members.name,
        departmentName: departments.name,
        project: { id: projects.id, name: projects.name },
        creatorName: creator.name,
        triggeredByName: triggerer.name,
        meeting: { id: meetings.id, title: meetings.title, startsAt: meetings.startsAt },
      })
      .from(tasks)
      .leftJoin(members, eq(tasks.assigneeId, members.id))
      .leftJoin(departments, eq(tasks.departmentId, departments.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
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
    departmentList(),
    projectList(),
  ]);
  after(runTasksSyncQuietly);
  if (!row || row.task.deletedAt) notFound();
  if (row.task.kind === "general") {
    const helpers = await db
      .select({ name: members.name })
      .from(generalTaskRequests)
      .innerJoin(members, eq(generalTaskRequests.memberId, members.id))
      .where(eq(generalTaskRequests.pickedTaskId, row.task.id));
    return (
      <GeneralTaskDetail
        task={row.task}
        isAdmin={me.isAdmin}
        helpers={helpers.map((h) => h.name)}
        events={events.map(({ event: e, actorName }) => ({ id: e.id, createdAt: e.createdAt, kind: e.kind, field: e.field, oldValue: e.oldValue, newValue: e.newValue, actorName }))}
      />
    );
  }
  const { task } = row;
  const editable = canEditTask(me, task);
  const inSheet = sheetState(task);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const fieldLabel = (f: string | null) => FIELD_LABELS[f as keyof typeof FIELD_LABELS] ?? f;

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/tasks" className={quietLinkClass}>
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
        <h1 className="font-display text-[clamp(1.75rem,5vw,2.5rem)] font-semibold leading-tight tracking-display">{task.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.createdByAi && <AiBadge confirmed={!!task.aiConfirmedAt} />}
          {task.type && <TypeBadge type={task.type} />}
          {task.dueDate && <DueDate date={task.dueDate} today={todayInLjubljana()} done={task.status === "done"} />}
          {row.assigneeName ? (
            <span className="text-muted">{row.assigneeName}</span>
          ) : row.departmentName ? (
            <span className="flex items-center gap-1.5 text-muted">
              <DepartmentBadge name={row.departmentName} />
              whole department{task.departmentId && me.departmentIds.includes(task.departmentId) ? " (yours)" : ""}
            </span>
          ) : (
            <span className="text-muted">Unassigned</span>
          )}
          {row.project?.id && (
            <Link href={`/projects?open=${row.project.id}`} className="text-xs font-medium text-link hover:underline">
              in {row.project.name}
            </Link>
          )}
          {row.creatorName && <span className="text-xs text-subtle">created by {row.creatorName}</span>}
          {inSheet === "removed" && <span className="text-xs text-warning">no longer in the sheet (its row was deleted there)</span>}
        </p>
        {task.createdByAi && (
          <div className="flex flex-col gap-1.5 rounded-card border border-violet-line bg-violet-bg p-5 text-sm text-fg-2" data-testid="ai-provenance">
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
              {/* Confirmed by the assignee, or accepted automatically while confirming was off (see the history). */}
              {task.aiConfirmedAt && " Confirmed."}
            </p>
            {task.sourceQuote && (
              <blockquote className="border-l-2 border-violet-line pl-3 italic text-muted">“{task.sourceQuote}”</blockquote>
            )}
          </div>
        )}
        {(canConfirmAiTask(me, task) || (task.createdByAi && !task.aiConfirmedAt && canDeleteAiTask(me, task))) && (
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-5" data-testid="ai-review">
            <p className="w-full text-sm font-semibold">Review this AI-created task</p>
            <p className="w-full text-sm text-muted">Check the title, person and date. Confirm it, change it below (or hand it to someone else), or delete it.</p>
            {canConfirmAiTask(me, task) && (
              <form action={confirmAiTaskAction.bind(null, task.id)}>
                <button type="submit" className={smallButtonClass}>
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
            {task.status !== "done" && canTakeTask(me, task) && (
              <form action={takeTaskAction.bind(null, task.id)}>
                <button type="submit" className={smallButtonClass}>
                  Take it
                </button>
              </form>
            )}
            <DoneToggle taskId={task.id} title={task.title} done={task.status === "done"} variant="button" />
            {task.status === "done" && task.completedAt && <span className="text-xs text-subtle">Done on {fmt(task.completedAt)}</span>}
            {task.status !== "done" && canTakeTask(me, task) && (
              <p className="w-full text-xs text-subtle">This task is for everyone in {row.departmentName}. Take it to make it yours, so the others know it is handled.</p>
            )}
          </div>
        )}
      </div>

      {me.isAdmin && (task.statusRaw || task.assigneeRaw || task.deadlineRaw) && (
        <details className="group rounded-card border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-medium text-muted">
            In the sheet{task.sheetRow ? `, row ${task.sheetRow}` : ""} · admins only
            <span aria-hidden className="transition group-open:rotate-45">+</span>
          </summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line p-5 text-sm">
          <dt className="text-subtle">status</dt>
          <dd>{task.statusRaw ?? "—"}</dd>
          <dt className="text-subtle">nosilec</dt>
          <dd>{task.assigneeRaw ?? "—"}</dd>
          <dt className="text-subtle">tip taska</dt>
          <dd>{task.typeRaw ?? "—"}</dd>
          <dt className="text-subtle">deadline</dt>
          <dd>{task.deadlineRaw ?? "—"}</dd>
        </dl>
        </details>
      )}

      {editable ? (
        <details className="group rounded-card border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-display text-sm font-semibold">
            Edit or hand over
            <span aria-hidden className="text-muted transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-line p-5">
          <TaskForm
            action={updateTaskAction.bind(null, task.id)}
            initial={{
              title: task.title,
              status: task.status,
              priority: task.priority,
              owner: ownerValue(task),
              projectId: task.projectId ? String(task.projectId) : "",
              // "marketing" from the sheet shows as the list's "Marketing"; other values stay as they are.
              type: normalizeType(task.type) ?? "",
              dueDate: task.dueDate ?? "",
            }}
            members={memberList}
            departments={departmentOptions}
            projects={projectOptions}
            submitLabel="Save task"
          />
          </div>
        </details>
      ) : (
        <p className="text-sm text-subtle">Only the assignee (or their department, for a department task), the person who created it, or an admin can change this task.</p>
      )}

      <details className="group rounded-card border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-display text-sm font-semibold">
          History <span className="font-sans font-normal text-subtle">· {events.length} {events.length === 1 ? "change" : "changes"}</span>
          <span aria-hidden className="ml-auto text-muted transition group-open:rotate-45">+</span>
        </summary>
        <ol className="flex flex-col gap-2 border-t border-line p-5 text-sm" data-testid="task-history">
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
      </details>
    </section>
  );
}
