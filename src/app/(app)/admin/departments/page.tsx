import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { departmentsWithCounts } from "@/lib/departments";
import { createDepartmentAction, deleteDepartmentAction, renameDepartmentAction } from "./actions";
import { DepartmentNameForm } from "./department-forms";

export default async function DepartmentsPage() {
  await requireAdmin();
  const [list, people] = await Promise.all([
    departmentsWithCounts(),
    db
      .select({ id: members.id, name: members.name, departmentId: members.departmentId })
      .from(members)
      .where(eq(members.active, true))
      .orderBy(asc(members.name)),
  ]);
  const without = people.filter((p) => !p.departmentId);

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Departments</h1>
        <p className="text-sm text-muted">
          Each member belongs to at most one department; set it on the member&apos;s page. A task can be given to a whole department: everyone in
          it sees it under My tasks, and one of them takes it.
        </p>
      </div>

      <ul className="flex flex-col gap-3" data-testid="departments">
        {list.map((d) => {
          const inIt = people.filter((p) => p.departmentId === d.id);
          return (
            <li key={d.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{d.name}</h2>
                <span className="text-sm text-muted">
                  {d.members} {d.members === 1 ? "member" : "members"} ·{" "}
                  <Link href="/tasks?view=all" className="hover:underline">
                    {d.openTasks} open {d.openTasks === 1 ? "task" : "tasks"} for the whole department
                  </Link>
                </span>
              </div>
              {inIt.length > 0 && (
                <p className="text-sm text-fg-2">
                  {inIt.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ", "}
                      <Link href={`/admin/members/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
              <DepartmentNameForm action={renameDepartmentAction.bind(null, d.id)} initial={d.name} label="Rename" />
              {d.members === 0 && d.openTasks === 0 && (
                <form action={deleteDepartmentAction.bind(null, d.id)}>
                  <button type="submit" className="text-sm font-medium text-danger hover:underline">
                    Delete {d.name}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line-strong bg-surface p-4">
        <h2 className="font-semibold">Add a department</h2>
        <DepartmentNameForm action={createDepartmentAction} label="Add" />
      </div>

      {without.length > 0 && (
        <p className="text-sm text-muted">
          Not in a department: {without.map((p) => p.name).join(", ")}.
        </p>
      )}
    </section>
  );
}
