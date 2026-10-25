import Link from "next/link";
import { after } from "next/server";
import { requireMember } from "@/lib/auth";
import { departmentList } from "@/lib/departments";
import { projectList } from "@/lib/projects/queries";
import { activeMembers } from "@/lib/tasks/queries";
import { DEFAULT_PRIORITY } from "@/lib/tasks/constants";
import { runTasksSyncQuietly } from "@/lib/tasks/sheet-sync";
import { createTaskAction } from "../actions";
import { TaskForm } from "../task-form";

/** ?project=<id> (from a project on /projects) starts the task in that project. */
export default async function NewTaskPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  after(runTasksSyncQuietly);
  const [memberList, departmentOptions, projectOptions] = await Promise.all([activeMembers(), departmentList(), projectList()]);
  const project = projectOptions.find((p) => String(p.id) === sp.project);
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <Link href={project ? `/projects?open=${project.id}` : "/tasks"} className="text-sm text-subtle hover:text-fg">
        ← {project ? project.name : "Tasks"}
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New task{project ? ` in ${project.name}` : ""}</h1>
      <TaskForm
        action={createTaskAction}
        initial={{ title: "", status: "todo", priority: DEFAULT_PRIORITY, owner: `m:${me.id}`, projectId: project ? String(project.id) : "", type: "", dueDate: "" }}
        members={memberList}
        departments={departmentOptions}
        projects={projectOptions}
        submitLabel="Create task"
      />
    </section>
  );
}
