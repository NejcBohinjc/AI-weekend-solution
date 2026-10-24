import { aliasedTable, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { DueDate, StatusBadge, TypeBadge } from "@/components/task-badges";
import { secondaryButtonClass } from "@/components/ui";
import { db } from "@/db";
import { members, taskEvents, tasks } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { FIELD_LABELS } from "@/lib/tasks/constants";
import { canEditTask } from "@/lib/tasks/permissions";
import { activeMembers, taskTypes } from "@/lib/tasks/queries";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { runTasksSyncQuietly } from "@/lib/tasks/sheet-sync";
import { tasksSyncStatus } from "@/lib/tasks/sync-status";
import { finishTaskAction, updateTaskAction } from "../actions";
import { SyncStatus } from "../sync-status";
import { TaskForm } from "../task-form";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [me, { id: rawId }, { created }] = await Promise.all([requireMember(), params, searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  after(runTasksSyncQuietly);

  const actor = aliasedTable(members, "actor");
  const creator = aliasedTable(members, "creator");
  const [[row], events, memberList, types, syncStatus] = await Promise.all([
    db
      .select({ task: tasks, assigneeName: members.name, creatorName: creator.name })
      .from(tasks)
      .leftJoin(members, eq(tasks.assigneeId, members.id))
      .leftJoin(creator, eq(tasks.createdById, creator.id))
      .where(eq(tasks.id, id))
      .limit(1),
    db
      .select({ event: taskEvents, actorName: actor.name })
      .from(taskEvents)
      .leftJoin(actor, eq(taskEvents.actorId, actor.id))
      .where(eq(taskEvents.taskId, id))
      .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id)),
    activeMembers(),
    taskTypes(),
    tasksSyncStatus(me.isAdmin),
  ]);
  if (!row) notFound();
  const { task } = row;
  const editable = canEditTask(me, task);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const fieldLabel = (f: string | null) => FIELD_LABELS[f as keyof typeof FIELD_LABELS] ?? f;

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/tasks" className="text-sm text-slate-500 hover:text-slate-900">
            ← Tasks
          </Link>
          <SyncStatus initial={syncStatus} />
        </div>
        {created && (
          <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Task created. It goes to the sheet in a moment.
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={task.status} />
          {task.type && <TypeBadge type={task.type} />}
          {task.dueDate && <DueDate date={task.dueDate} today={todayInLjubljana()} done={task.status === "done"} />}
          <span className="text-slate-600">{row.assigneeName ?? "Unassigned"}</span>
          {row.creatorName && <span className="text-xs text-slate-400">created by {row.creatorName}</span>}
          {!task.inSheet && <span className="text-xs text-amber-700">no longer in the sheet</span>}
        </p>
        {editable && task.status !== "done" && (
          <form action={finishTaskAction.bind(null, task.id)}>
            <button type="submit" className={secondaryButtonClass}>
              ✓ Mark as done
            </button>
          </form>
        )}
      </div>

      {me.isAdmin && (task.statusRaw || task.assigneeRaw || task.deadlineRaw) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <dt className="col-span-2 mb-1 font-semibold">
            In the sheet{task.sheetRow ? `, row ${task.sheetRow}` : ""} <span className="font-normal text-slate-500">· as last read · admins only</span>
          </dt>
          <dt className="text-slate-500">status</dt>
          <dd>{task.statusRaw ?? "—"}</dd>
          <dt className="text-slate-500">nosilec</dt>
          <dd>{task.assigneeRaw ?? "—"}</dd>
          <dt className="text-slate-500">tip taska</dt>
          <dd>{task.typeRaw ?? "—"}</dd>
          <dt className="text-slate-500">deadline</dt>
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
              type: task.type ?? "",
              dueDate: task.dueDate ?? "",
            }}
            members={memberList}
            types={types}
            submitLabel="Save task"
          />
        </div>
      ) : (
        <p className="text-sm text-slate-500">Only the assignee, the person who created it, or an admin can change this task.</p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">History</h2>
        <ol className="flex flex-col gap-2 border-l-2 border-slate-200 pl-4 text-sm" data-testid="task-history">
          {events.map(({ event: e, actorName }) => (
            <li key={e.id}>
              <span className="text-slate-500">{fmt(e.createdAt)} · </span>
              <span className="font-medium">{e.source === "sheet_sync" ? `Sheet sync${actorName ? ` (${actorName})` : ""}` : actorName}</span>
              {": "}
              {e.kind === "created"
                ? e.newValue
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
