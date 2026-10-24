import { aliasedTable, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DueDate, StatusBadge, TypeBadge } from "@/components/task-badges";
import { db } from "@/db";
import { members, taskEvents, tasks } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { FIELD_LABELS } from "@/lib/tasks/constants";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { updateTaskAction } from "../actions";
import { TaskEditForm } from "./task-edit-form";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const [me, { id: rawId }] = await Promise.all([requireMember(), params]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const actor = aliasedTable(members, "actor");
  const [[row], events, memberList] = await Promise.all([
    db
      .select({ task: tasks, assigneeName: members.name })
      .from(tasks)
      .leftJoin(members, eq(tasks.assigneeId, members.id))
      .where(eq(tasks.id, id))
      .limit(1),
    db
      .select({ event: taskEvents, actorName: actor.name })
      .from(taskEvents)
      .leftJoin(actor, eq(taskEvents.actorId, actor.id))
      .where(eq(taskEvents.taskId, id))
      .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id)),
    me.isAdmin
      ? db.select({ id: members.id, name: members.name }).from(members).where(eq(members.active, true)).orderBy(asc(members.name))
      : Promise.resolve([]),
  ]);
  if (!row) notFound();
  const { task } = row;
  const fromSheet = task.source === "gsheet";
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/tasks" className="text-sm text-slate-500 hover:text-slate-900">
          ← Tasks
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={task.status} />
          {task.type && <TypeBadge type={task.type} />}
          {task.dueDate && <DueDate date={task.dueDate} today={todayInLjubljana()} done={task.status === "done"} />}
          <span className="text-slate-600">{row.assigneeName ?? "Unassigned"}</span>
        </p>
      </div>

      {me.isAdmin && fromSheet && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <dt className="col-span-2 mb-1 font-semibold">
            From Google Sheets{task.sheetRow ? `, row ${task.sheetRow}` : ""}
            {!task.inSheet && <span className="font-normal text-amber-700"> · no longer in the sheet</span>}
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

      {me.isAdmin && (
        <TaskEditForm
          action={updateTaskAction.bind(null, task.id)}
          task={{ status: task.status, assigneeId: task.assigneeId, type: task.type, dueDate: task.dueDate, lockedFields: task.lockedFields }}
          members={memberList}
          fromSheet={fromSheet}
        />
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
                : `${FIELD_LABELS[e.field as keyof typeof FIELD_LABELS] ?? e.field}: ${e.oldValue ?? "empty"} → ${e.newValue ?? "empty"}`}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
