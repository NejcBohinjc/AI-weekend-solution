import Link from "next/link";
import { AiBadge, DepartmentBadge, DueDate, PriorityBadge, StatusBadge } from "@/components/task-badges";
import { requireMember } from "@/lib/auth";
import { unfinishedLabel } from "@/lib/projects/overview";
import { projectsOverview } from "@/lib/projects/queries";
import { todayInLjubljana } from "@/lib/tasks/sheet-mapping";
import { createProjectAction, deleteProjectAction, updateProjectAction } from "./actions";
import { ProjectForm } from "./project-forms";

/**
 * Every project collapsed to one line with how many of its tasks are unfinished; a click opens the
 * list of all its tasks. Tasks without a project come last. Admins add, rename and delete projects.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  const groups = await projectsOverview();
  const today = todayInLjubljana();
  const projectCount = groups.filter((g) => g.project).length;
  const unfinished = groups.reduce((n, g) => n + g.unfinished, 0);

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <p className="text-sm text-muted">
          {projectCount} {projectCount === 1 ? "project" : "projects"} · {unfinished} unfinished {unfinished === 1 ? "task" : "tasks"} · open a project to see
          its tasks
        </p>
      </div>

      {me.isAdmin && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line-strong bg-surface p-4">
          <h2 className="text-sm font-semibold">New project</h2>
          <ProjectForm action={createProjectAction} submitLabel="Add project" />
        </div>
      )}

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-sm text-subtle">
          No projects yet.{me.isAdmin ? " Add the first one above." : " An admin adds them."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="projects">
          {groups.map((g) => {
            const key = g.project ? String(g.project.id) : "none";
            return (
              <li key={key}>
                <details open={sp.open === key} className="group overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true" className="text-subtle transition-transform group-open:rotate-90">
                      ›
                    </span>
                    <span className={`min-w-0 flex-1 truncate font-semibold ${g.project ? "" : "text-muted"}`}>{g.project?.name ?? "No project"}</span>
                    <span className={`shrink-0 text-sm ${g.unfinished ? "text-fg-2" : "text-subtle"}`} data-testid="unfinished">
                      {unfinishedLabel(g)}
                    </span>
                  </summary>

                  <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
                    {g.project?.description && <p className="text-sm text-muted">{g.project.description}</p>}
                    {!g.project && <p className="text-sm text-muted">Tasks not in any project yet. Open one and pick its project.</p>}

                    {g.tasks.length > 0 ? (
                      <ul className="divide-y divide-line" data-testid="project-tasks">
                        {g.tasks.map((t) => (
                          <li key={t.id}>
                            <Link href={`/tasks/${t.id}`} className="flex flex-col gap-1 py-2 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-3">
                              <span className={`min-w-0 flex-1 ${t.status === "done" ? "text-subtle line-through" : ""}`}>{t.title}</span>
                              <span className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={t.status} />
                                {t.status !== "done" && <PriorityBadge priority={t.priority} />}
                                {t.createdByAi && <AiBadge confirmed={!!t.aiConfirmedAt} />}
                                {t.dueDate && <DueDate date={t.dueDate} today={today} done={t.status === "done"} />}
                                {t.assigneeName ? (
                                  <span className="text-xs text-muted">{t.assigneeName}</span>
                                ) : t.departmentName ? (
                                  <DepartmentBadge name={t.departmentName} />
                                ) : (
                                  <span className="text-xs text-warning">Unassigned</span>
                                )}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-subtle">No tasks in this project yet.</p>
                    )}

                    {g.project && (
                      <div className="flex flex-wrap items-center gap-3">
                        <Link href={`/tasks/new?project=${g.project.id}`} className="text-sm font-medium text-link hover:underline">
                          + Add a task to {g.project.name}
                        </Link>
                        {me.isAdmin && g.tasks.length === 0 && (
                          <form action={deleteProjectAction.bind(null, g.project.id)}>
                            <button type="submit" aria-label={`Delete ${g.project.name}`} className="text-sm font-medium text-danger hover:underline">
                              Delete project
                            </button>
                          </form>
                        )}
                      </div>
                    )}

                    {me.isAdmin && g.project && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-subtle">Rename or change the description</summary>
                        <div className="mt-2">
                          <ProjectForm
                            action={updateProjectAction.bind(null, g.project.id)}
                            initial={{ name: g.project.name, description: g.project.description }}
                            submitLabel="Save"
                          />
                        </div>
                      </details>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
