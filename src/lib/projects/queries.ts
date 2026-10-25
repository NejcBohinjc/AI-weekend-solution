// Reads for projects (see the projects table in db/schema.ts).
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { departments, members, projects, tasks } from "@/db/schema";
import { groupByProject } from "./overview";

export function projectList() {
  return db.select({ id: projects.id, name: projects.name, description: projects.description }).from(projects).orderBy(asc(projects.name));
}

/** Every project with its tasks (not deleted), then the tasks without a project. */
export async function projectsOverview() {
  const [list, rows] = await Promise.all([
    projectList(),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
        projectId: tasks.projectId,
        priority: tasks.priority,
        assigneeName: members.name,
        departmentName: departments.name,
        createdByAi: tasks.createdByAi,
        aiConfirmedAt: tasks.aiConfirmedAt,
      })
      .from(tasks)
      .leftJoin(members, eq(tasks.assigneeId, members.id))
      .leftJoin(departments, eq(tasks.departmentId, departments.id))
      .where(isNull(tasks.deletedAt)),
  ]);
  return groupByProject(list, rows);
}
