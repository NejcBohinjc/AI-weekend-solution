import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { after } from "next/server";
import { AiBadge, DepartmentBadge, DueDate, PriorityBadge, StatusBadge } from "@/components/task-badges";
import { quietLinkClass } from "@/components/ui";
import { EmptyState, PageTitle, PrimaryLink } from "@/components/ui-kit";
import { db } from "@/db";
import { departments, members, projects, tasks, taskSyncs } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, type TaskPriority, type TaskStatus } from "@/lib/tasks/constants";
import { canEditTask } from "@/lib/tasks/permissions";
import { myTasksCondition, priorityOrder } from "@/lib/tasks/queries";
import { sheetState } from "@/lib/tasks/sheet-state";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { runTasksSyncQuietly, type SyncReport } from "@/lib/tasks/sheet-sync";
import { tasksSyncStatus } from "@/lib/tasks/sync-status";
import { DoneToggle } from "./done-toggle";
import { SyncReportPanel } from "./sync-panel";
import { GeneralTasks } from "./general-tasks";
import { SyncStatus } from "./sync-status";

type Search = { view?: string; type?: string; status?: string; priority?: string; deleted?: string; tab?: string; picked?: string; error?: string };

/** My tasks / All tasks / General tasks. General tasks are a separate tab, never mixed into project tasks. */
function TaskTabs({ current, href }: { current: "mine" | "all" | "general"; href: (v: "mine" | "all") => string }) {
  const tabs = [
    { key: "mine", label: "Mine", href: href("mine") },
    { key: "all", label: "Everyone's", href: href("all") },
    { key: "general", label: "General", href: "/tasks?tab=general" },
  ] as const;
  return (
    <nav aria-label="Task view" className="inline-flex self-start rounded-pill bg-surface-3 p-1 font-display text-sm font-semibold">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`whitespace-nowrap rounded-pill px-4 py-1.5 transition ${current === t.key ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  // Background sync if the last one is over a minute old; the page never waits for it.
  after(runTasksSyncQuietly);
  const view = sp.view === "all" ? "all" : "mine";
  if (sp.tab === "general") {
    return (
      <section className="flex flex-col gap-8">
        <PageTitle accent="tasks" sub="Standing tasks anyone can help with.">
          General
        </PageTitle>
        <TaskTabs current="general" href={(v) => (v === "all" ? "/tasks?view=all" : "/tasks")} />
        <GeneralTasks me={me} picked={sp.picked === "1"} error={sp.error} />
      </section>
    );
  }
  const status = TASK_STATUSES.includes(sp.status as TaskStatus) ? (sp.status as TaskStatus) : undefined;
  const priority = TASK_PRIORITIES.includes(sp.priority as TaskPriority) ? (sp.priority as TaskPriority) : undefined;
  // A type from TASK_TYPES, "none", or "other" (types typed freely in the sheet).
  const type = sp.type === "none" || sp.type === "other" || (TASK_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type : undefined;
  const listedTypes = sql.join(TASK_TYPES.map((t) => sql`${t.toLowerCase()}`), sql`, `);

  const where: SQL[] = [isNull(tasks.deletedAt)];
  // General tasks have their own tab; My tasks also shows the ones I hold (to tick when done).
  if (view === "all") where.push(eq(tasks.kind, "project"));
  if (view === "mine") where.push(myTasksCondition(me));
  if (status) where.push(eq(tasks.status, status));
  if (priority) where.push(eq(tasks.priority, priority));
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
        priority: tasks.priority,
        kind: tasks.kind,
        assigneeRaw: tasks.assigneeRaw,
        assigneeId: tasks.assigneeId,
        departmentId: tasks.departmentId,
        departmentName: departments.name,
        projectName: projects.name,
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
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(...where))
      // Open tasks first, most pressing priority first, then the soonest due date; finished ones last.
      .orderBy(sql`${tasks.status} = 'done'`, sql`case when ${tasks.status} = 'done' then 0 else ${priorityOrder} end`, sql`${tasks.dueDate} asc nulls last`, asc(tasks.title)),
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
    const params = new URLSearchParams(Object.entries({ view, type, status, priority, ...patch }).filter(([, v]) => v) as [string, string][]);
    if (params.get("view") === "mine") params.delete("view");
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };
  const toReview = rows.filter((r) => r.createdByAi && !r.aiConfirmedAt && r.assigneeId === me.id).length;
  const pendingInSheet = new Set(rows.filter((r) => r.kind !== "general" && sheetState(r) === "pending").map((r) => r.id)); // general tasks never go to the sheet

  const activeFilters = [type, status, priority].filter(Boolean).length;
  const openRows = rows.filter((r) => r.status !== "done");
  const doneRows = rows.filter((r) => r.status === "done");
  const renderRow = (t: (typeof rows)[number]) => (
    <li key={t.id} className="flex items-center">
      <Link href={`/tasks/${t.id}`} className="flex min-w-0 flex-1 flex-col gap-1.5 px-5 py-4 transition hover:bg-surface-2">
        <span className={`font-medium ${t.status === "done" ? "text-subtle line-through" : ""}`}>{t.title}</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <StatusBadge status={t.status} />
          {t.kind === "general" && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2">General task</span>}
          {t.status !== "done" && t.kind !== "general" && <PriorityBadge priority={t.priority} />}
          {t.createdByAi && <AiBadge confirmed={!!t.aiConfirmedAt} />}
          {t.createdByAi && !t.aiConfirmedAt && t.assigneeId === me.id && <span className="text-xs font-semibold text-violet">Review</span>}
          {t.dueDate && <DueDate date={t.dueDate} today={today} done={t.status === "done"} />}
          {t.assigneeName ? (
            <span className="text-sm text-muted">{t.assigneeName}</span>
          ) : t.departmentName ? (
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <DepartmentBadge name={t.departmentName} />
              {t.departmentId && me.departmentIds.includes(t.departmentId) ? "your department" : "department"}
            </span>
          ) : (
            <span className="text-sm text-warning">Unassigned{t.assigneeRaw && me.isAdmin ? ` (sheet: “${t.assigneeRaw}”)` : ""}</span>
          )}
          {t.projectName && <span className="text-sm text-subtle">in {t.projectName}</span>}
          {!t.inSheet && me.isAdmin && <span className="text-xs text-subtle">no longer in sheet</span>}
          {pendingInSheet.has(t.id) && <span className="text-xs text-warning">not in the sheet yet</span>}
        </span>
      </Link>
      {canEditTask(me, t) && (
        <div className="pr-4">
          <DoneToggle taskId={t.id} title={t.title} done={t.status === "done"} general={t.kind === "general"} />
        </div>
      )}
    </li>
  );
  const listClass = "divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card";

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle accent="tasks" sub={`${rows.length} ${rows.length === 1 ? "task" : "tasks"}, ${openRows.length} open`}>
          {view === "mine" ? "My" : "All"}
        </PageTitle>
        <PrimaryLink href="/tasks/new">New task</PrimaryLink>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TaskTabs current={view} href={(v) => href({ view: v })} />
        <SyncStatus initial={syncStatus} awaitSync={pendingInSheet.size > 0} />
      </div>

      {sp.deleted && (
        <p role="status" className="rounded-xl bg-surface-3 px-4 py-3 text-sm text-fg-2">
          The AI-created task was deleted. Running the AI again on the same notes will not bring it back.
        </p>
      )}
      {toReview > 0 && (
        <p className="rounded-card border border-violet-line bg-violet-bg px-5 py-4 text-sm text-violet" data-testid="review-banner">
          {toReview === 1 ? "1 task the AI created from meeting notes is" : `${toReview} tasks the AI created from meeting notes are`} waiting for
          your review. Open it to confirm, change or delete it.
        </p>
      )}
      {me.isAdmin && lastSync[0] && (
        <details className="group rounded-card border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-medium text-muted">
            Sheet sync details · admins
            <span aria-hidden className="transition group-open:rotate-45">+</span>
          </summary>
          <div className="border-t border-line p-4">
            <SyncReportPanel report={lastSync[0].report as SyncReport} by={lastSync[0].by ?? null} />
          </div>
        </details>
      )}

      <details open={activeFilters > 0} className="group rounded-card border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 font-display text-sm font-semibold">
          <span>
            Filters
            {activeFilters > 0 && <span className="ml-2 rounded-pill bg-primary px-2 py-0.5 text-xs text-on-primary">{activeFilters}</span>}
          </span>
          <span aria-hidden className="text-muted transition group-open:rotate-45">+</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-line p-5 text-sm">
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
          <FilterRow label="Priority">
            <Chip href={href({ priority: "" })} active={!priority}>
              Any
            </Chip>
            {TASK_PRIORITIES.map((p) => (
              <Chip key={p} href={href({ priority: p })} active={priority === p}>
                {PRIORITY_LABELS[p]}
              </Chip>
            ))}
          </FilterRow>
          {activeFilters > 0 && (
            <Link href={href({ type: "", status: "", priority: "" })} className={quietLinkClass}>
              Clear filters
            </Link>
          )}
        </div>
      </details>

      {rows.length === 0 ? (
        <EmptyState
          title={view === "mine" ? "No tasks assigned to you" : "No tasks"}
          hint={activeFilters > 0 ? "Nothing matches these filters." : "Add one, or pick up a general task."}
          href={activeFilters > 0 ? href({ type: "", status: "", priority: "" }) : "/tasks/new"}
          action={activeFilters > 0 ? "Clear filters" : "Add a task"}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {openRows.length > 0 && (
            <ul className={listClass} data-testid="task-list">
              {openRows.map(renderRow)}
            </ul>
          )}
          {doneRows.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-1 pb-3 font-display text-sm font-semibold text-muted hover:text-fg">
                <span aria-hidden className="transition group-open:rotate-90">›</span>
                {doneRows.length} finished
              </summary>
              <ul className={listClass} data-testid="task-list-done">
                {doneRows.map(renderRow)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-display text-xs font-semibold uppercase tracking-eyebrow text-subtle">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-pill px-3.5 py-1.5 text-sm font-medium transition ${active ? "bg-primary text-on-primary" : "bg-surface-3 text-fg-2 hover:bg-surface-4"}`}
    >
      {children}
    </Link>
  );
}
