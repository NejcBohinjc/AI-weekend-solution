import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByProject, sortTasks, unfinishedLabel, type OverviewTask } from "./overview";

const t = (id: number, title: string, status: OverviewTask["status"], dueDate: string | null, projectId: number | null): OverviewTask => ({
  id,
  title,
  status,
  dueDate,
  projectId,
});

test("tasks: unfinished first by due date (none last), finished at the end", () => {
  const sorted = sortTasks([
    t(1, "Done early", "done", "2026-10-01", 1),
    t(2, "No date", "todo", null, 1),
    t(3, "Later", "in_progress", "2026-11-20", 1),
    t(4, "Sooner", "verification", "2026-10-30", 1),
    t(5, "Also no date", "todo", null, 1),
  ]);
  assert.deepEqual(sorted.map((x) => x.title), ["Sooner", "Later", "Also no date", "No date", "Done early"]);
});

test("tasks: unfinished by priority first (urgent, medium, low), then by due date", () => {
  const sorted = sortTasks([
    { ...t(1, "Low soon", "todo", "2026-10-26", 1), priority: "low" },
    { ...t(2, "Medium later", "todo", "2026-11-20", 1), priority: "medium" },
    { ...t(3, "Urgent no date", "todo", null, 1), priority: "urgent" },
    { ...t(4, "Urgent soon", "in_progress", "2026-10-28", 1), priority: "urgent" },
    { ...t(5, "Medium soon", "todo", "2026-10-27", 1), priority: "medium" },
    { ...t(6, "Done urgent", "done", "2026-10-01", 1), priority: "urgent" },
  ]);
  assert.deepEqual(sorted.map((x) => x.title), ["Urgent soon", "Urgent no date", "Medium soon", "Medium later", "Low soon", "Done urgent"]);
});

test("groups every project (also empty ones) and puts tasks without a project last", () => {
  const projects = [
    { id: 1, name: "Grants", description: null },
    { id: 2, name: "Website", description: "New site" },
  ];
  const groups = groupByProject(projects, [
    t(1, "Report", "todo", null, 1),
    t(2, "Budget", "done", null, 1),
    t(3, "Plakat", "in_progress", null, null),
    t(4, "Old", "todo", null, 99), // a project that no longer exists counts as none
  ]);
  assert.deepEqual(
    groups.map((g) => [g.project?.name ?? null, g.tasks.map((x) => x.title), g.unfinished]),
    [
      ["Grants", ["Report", "Budget"], 1],
      ["Website", [], 0],
      [null, ["Old", "Plakat"], 2],
    ],
  );
  assert.equal(groupByProject(projects, [t(1, "Report", "todo", null, 1)]).length, 2, "no empty no-project group");
});

test("says how many tasks remain unfinished", () => {
  assert.equal(unfinishedLabel({ unfinished: 3, tasks: [1, 2, 3, 4] }), "3 unfinished tasks");
  assert.equal(unfinishedLabel({ unfinished: 1, tasks: [1] }), "1 unfinished task");
  assert.equal(unfinishedLabel({ unfinished: 0, tasks: [1] }), "All done");
  assert.equal(unfinishedLabel({ unfinished: 0, tasks: [] }), "No tasks yet");
});
