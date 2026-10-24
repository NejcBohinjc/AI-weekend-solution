import { and, asc, desc, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { after } from "next/server";
import { AiBadge, DepartmentBadge, DueDate, StatusBadge, TypeBadge } from "@/components/task-badges";
import { db } from "@/db";
import { departments, members, tasks, taskSyncs } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { STATUS_LABELS, TASK_STATUSES, TASK_TYPES, type TaskStatus } from "@/lib/tasks/constants";
import { canEditTask } from "@/lib/tasks/permissions";
import { sheetState } from "@/lib/tasks/sheet-state";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { runTasksSyncQuietly, type SyncReport } from "@/lib/tasks/sheet-sync";
import { tasksSyncStatus } from "@/lib/tasks/sync-status";
import { finishTaskAction } from "./actions";
import { SyncReportPanel } from "./sync-panel";
import { SyncStatus } from "./sync-status";

type Search = { view?: string; type?: string; status?: string; deleted?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  // Background sync if the last one is over a minute old; the page never waits for it.
  after(runTasksSyncQuietly);
  const view = sp.view === "all" ? "all" : "mine";
  const status = TASK_STATUSES.includes(sp.status as TaskStatus) ? (sp.status as TaskStatus) : undefined;
  // A type from TASK_TYPES, "none", or "other" (types typed freely in the sheet).
  const type = sp.type === "none" || sp.type === "other" || (TASK_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type : undefined;
  const listedTypes = sql.join(TASK_TYPES.map((t) => sql`${t.toLowerCase()}`), sql`, `);

  const where: SQL[] = [isNull(tasks.deletedAt)];
  // Mine: assigned to me, or delegated to my department and not yet taken by anyone.
  if (view === "mine") {
    where.push(
      me.departmentId
        ? or(eq(tasks.assigneeId, me.id), and(isNull(tasks.assigneeId), eq(tasks.departmentId, me.departmentId)))!
        : eq(tasks.assigneeId, me.id),
    );
  }
  if (status) where.push(eq(tasks.status, status));
  if (type === "none") where.push(isNull(tasks.type));
  else if (type === "other") where.push(isNotNull(tasks.type), sql`lower(${tasks.type}) not in (${listedTypes})`);
  else if (type) where.push(sql`lower(${tasks.type}) = ${type.toLowerCase()}`);

  const [rows, lastSync, syncStatus] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        type: tasks.type,
        dueDate: tasks.dueDate,
        assigneeRaw: tasks.assigneeRaw,
        assigneeId: tasks.assigneeId,
        departmentId: tasks.departmentId,
        departmentName: departments.name,
        createdById: tasks.createdById,
        assigneeName: members.name,
        inSheet: tasks.inSheet,
        source: tasks.source,
        sheetSnapshot: tasks.sheetSnapshot,
        createdByAi: tasks.createdByAi,
        aiConfirmedAt: tasks.aiConfirmedAt,
        triggeredById: tasks.triggeredById,
      })
      .from(tasks)
      .leftJoin(members, eq(tasks.assigneeId, members.id))
      .leftJoin(departments, eq(tasks.departmentId, departments.id))
      .where(and(...where))
      .orderBy(sql`${tasks.status} = 'done'`, sql`${tasks.dueDate} asc nulls last`, asc(tasks.title)),
    me.isAdmin
      ? db
          .select({ report: taskSyncs.report, by: members.name })
          .from(taskSyncs)
          .leftJoin(members, eq(taskSyncs.actorId, members.id))
          .orderBy(desc(taskSyncs.id))
          .limit(1)
      : Promise.resolve([]),
    tasksSyncStatus(),
  ]);
  const today = todayInLjubljana();
  const href = (patch: Search) => {
    const params = new URLSearchParams(Object.entries({ view, type, status, ...patch }).filter(([, v]) => v) as [string, string][]);
    if (params.get("view") === "mine") params.delete("view");
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };
  const open = rows.filter((r) => r.status !== "done").length;
  const toReview = rows.filter((r) => r.createdByAi && !r.aiConfirmedAt && r.assigneeId === me.id).length;
  const pendingInSheet = new Set(rows.filter((r) => sheetState(r) === "pending").map((r) => r.id));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{view === "mine" ? "My tasks" : "All tasks"}</h1>
          <p className="text-sm text-muted">
            {rows.length} {rows.length === 1 ? "task" : "tasks"}, {open} open
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tasks/new" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-hover">
            New task
          </Link>
          <nav aria-label="Task view" className="flex rounded-xl bg-surface-3 p-1 text-sm font-medium">
            {(["mine", "all"] as const).map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                aria-current={view === v ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 ${view === v ? "bg-surface shadow-sm" : "text-muted"}`}
              >
                {v === "mine" ? "My tasks" : "All tasks"}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {sp.deleted && (
        <p role="status" className="rounded-xl bg-surface-3 px-4 py-3 text-sm text-fg-2">
          The AI-created task was deleted. Running the AI again on the same notes will not bring it back.
        </p>
      )}
      {toReview > 0 && (
        <p className="rounded-xl border border-violet-line bg-violet-bg px-4 py-3 text-sm text-violet" data-testid="review-banner">
          {toReview === 1 ? "1 task the AI created from meeting notes is" : `${toReview} tasks the AI created from meeting notes are`} waiting for
          your review. Open it to confirm, change or delete it.
        </p>
      )}
      <SyncStatus initial={syncStatus} awaitSync={pendingInSheet.size > 0} />
      {me.isAdmin && lastSync[0] && <SyncReportPanel report={lastSync[0].report as SyncReport} by={lastSync[0].by ?? null} />}

      <div className="flex flex-col gap-2 text-sm">
        <FilterRow label="Type">
          <Chip href={href({ type: "" })} active={!type}>
            Any
          </Chip>
          {TASK_TYPES.map((t) => (
            <Chip key={t} href={href({ type: t })} active={type === t}>
              {t}
            </Chip>
          ))}
          <Chip href={href({ type: "none" })} active={type === "none"}>
            No type
          </Chip>
          <Chip href={href({ type: "other" })} active={type === "other"}>
            Other types
          </Chip>
        </FilterRow>
        <FilterRow label="Status">
          <Chip href={href({ status: "" })} active={!status}>
            Any
          </Chip>
          {TASK_STATUSES.map((s) => (
            <Chip key={s} href={href({ status: s })} active={status === s}>
              {STATUS_LABELS[s]}
            </Chip>
          ))}
        </FilterRow>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-sm text-subtle">
          {view === "mine" ? "No tasks assigned to you" : "No tasks"}
          {type || status ? " with these filters." : "."}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm" data-testid="task-list">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center">
              <Link href={`/tasks/${t.id}`} className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3 hover:bg-surface-2">
                <span className={`font-medium ${t.status === "done" ? "text-subtle line-through" : ""}`}>{t.title}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={t.status} />
                  {t.createdByAi && <AiBadge confirmed={!!t.aiConfirmedAt} />}
                  {t.createdByAi && !t.aiConfirmedAt && t.assigneeId === me.id && (
                    <span className="text-xs font-semibold text-violet">Review</span>
                  )}
                  {t.type && <TypeBadge type={t.type} />}
                  {t.dueDate && <DueDate date={t.dueDate} today={today} done={t.status === "done"} />}
                  {t.assigneeName ? (
                    <span className="text-xs text-muted">{t.assigneeName}</span>
                  ) : t.departmentName ? (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <DepartmentBadge name={t.departmentName} />
                      {t.departmentId === me.departmentId ? "your department" : "department"}
                    </span>
                  ) : (
                    <span className="text-xs text-warning">
                      Unassigned{t.assigneeRaw && me.isAdmin ? ` (sheet: “${t.assigneeRaw}”)` : ""}
                    </span>
                  )}
                  {!t.inSheet && me.isAdmin && <span className="text-xs text-subtle">no longer in sheet</span>}
                  {pendingInSheet.has(t.id) && <span className="text-xs text-warning">not in the sheet yet</span>}
                </span>
              </Link>
              {t.status !== "done" && canEditTask(me, t) && (
                <form action={finishTaskAction.bind(null, t.id)} className="pr-3">
                  <button
                    type="submit"
                    aria-label={`Mark “${t.title}” as done`}
                    title="Mark as done"
                    className="flex size-9 items-center justify-center rounded-full border border-line-strong text-subtle hover:border-success hover:bg-success-bg hover:text-success"
                  >
                    ✓
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wide text-subtle">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 rounded-full px-3 py-1 ${active ? "bg-primary text-on-primary" : "bg-surface text-fg-2 ring-1 ring-line hover:bg-surface-2"}`}
    >
      {children}
    </Link>
  );
}
