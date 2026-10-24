import Link from "next/link";
import { after } from "next/server";
import { requireMember } from "@/lib/auth";
import { departmentList } from "@/lib/departments";
import { activeMembers } from "@/lib/tasks/queries";
import { runTasksSyncQuietly } from "@/lib/tasks/sheet-sync";
import { createTaskAction } from "../actions";
import { TaskForm } from "../task-form";

export default async function NewTaskPage() {
  const me = await requireMember();
  after(runTasksSyncQuietly);
  const [memberList, departmentOptions] = await Promise.all([activeMembers(), departmentList()]);
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <Link href="/tasks" className="text-sm text-subtle hover:text-fg">
        ← Tasks
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New task</h1>
      <TaskForm
        action={createTaskAction}
        initial={{ title: "", status: "todo", owner: `m:${me.id}`, type: "", dueDate: "" }}
        members={memberList}
        departments={departmentOptions}
        submitLabel="Create task"
      />
    </section>
  );
}
