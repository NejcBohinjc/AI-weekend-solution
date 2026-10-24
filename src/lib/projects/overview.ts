// Groups tasks under their projects for the projects overview. Pure, so it is unit-tested
// (overview.test.ts).
import type { TaskStatus } from "@/lib/tasks/constants";

export type OverviewTask = { id: number; title: string; status: TaskStatus; dueDate: string | null; projectId: number | null };
export type ProjectGroup<T extends OverviewTask> = {
  project: { id: number; name: string; description: string | null } | null; // null: tasks without a project
  tasks: T[];
  unfinished: number;
};

/** Unfinished first (soonest due date first, no date last, then by title), finished at the end. */
export function sortTasks<T extends OverviewTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const doneA = a.status === "done" ? 1 : 0;
    const doneB = b.status === "done" ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    if (a.dueDate !== b.dueDate) return a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate.localeCompare(b.dueDate);
    return a.title.localeCompare(b.title);
  });
}

/**
 * One group per project (in the given order, empty projects included), then a "no project" group if
 * any task has none. `unfinished` counts every task that is not done.
 */
export function groupByProject<T extends OverviewTask>(
  projects: { id: number; name: string; description: string | null }[],
  tasks: T[],
): ProjectGroup<T>[] {
  const group = (project: ProjectGroup<T>["project"], list: T[]): ProjectGroup<T> => ({
    project,
    tasks: sortTasks(list),
    unfinished: list.filter((t) => t.status !== "done").length,
  });
  const known = new Set(projects.map((p) => p.id));
  const groups = projects.map((p) => group(p, tasks.filter((t) => t.projectId === p.id)));
  const loose = tasks.filter((t) => t.projectId === null || !known.has(t.projectId));
  return loose.length ? [...groups, group(null, loose)] : groups;
}

/** "3 unfinished tasks", "1 unfinished task", "All done", "No tasks yet". */
export function unfinishedLabel(g: { unfinished: number; tasks: unknown[] }): string {
  if (!g.tasks.length) return "No tasks yet";
  if (!g.unfinished) return "All done";
  return `${g.unfinished} unfinished ${g.unfinished === 1 ? "task" : "tasks"}`;
}
