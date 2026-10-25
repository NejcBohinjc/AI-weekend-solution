import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { memberDepartments, members } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { tierOfDepartment } from "@/lib/department-rules";
import { departmentsWithCounts } from "@/lib/departments";
import { dangerLinkClass, quietLinkClass } from "@/components/ui";
import { PageTitle } from "@/components/ui-kit";
import { createDepartmentAction, deleteDepartmentAction, renameDepartmentAction, setDepartmentMembersAction } from "./actions";
import { DepartmentMembersForm, DepartmentNameForm } from "./department-forms";

export default async function DepartmentsPage() {
  // The lists do not depend on who is asking, so they run while the session is being checked.
  const [, list, everyone, withDepartment] = await Promise.all([
    requireAdmin(),
    departmentsWithCounts(),
    db.select({ id: members.id, name: members.name, tier: members.tier }).from(members).where(eq(members.active, true)).orderBy(asc(members.name)),
    db.selectDistinct({ id: memberDepartments.memberId }).from(memberDepartments),
  ]);
  const inSome = new Set(withDepartment.map((r) => r.id));
  const without = everyone.filter((p) => !inSome.has(p.id));

  return (
    <section className="flex max-w-2xl flex-col gap-8">
      <PageTitle accent="departments" sub="A member can be in any number of departments, or none. Tick who is in one under “Edit members” here, or set a single member's departments on their own page. A task given to a whole department shows under My tasks for everyone in it, and one of them takes it.">
        Our
      </PageTitle>

      <ul className="flex flex-col gap-3" data-testid="departments">
        {list.map((d) => {
          const onlyFor = tierOfDepartment(d.name);
          return (
            <li key={d.id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-semibold tracking-display">
                  {d.name}
                  {onlyFor && <span className="ml-2 text-xs font-normal text-subtle">only for the {onlyFor} tier</span>}
                </h2>
                <span className="text-sm text-muted">
                  {d.members.length} {d.members.length === 1 ? "member" : "members"} ·{" "}
                  <Link href="/tasks?view=all" className="hover:underline">
                    {d.openTasks} open {d.openTasks === 1 ? "task" : "tasks"} for the whole department
                  </Link>
                </span>
              </div>
              {d.members.length > 0 && (
                <p className="text-sm text-fg-2">
                  {d.members.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ", "}
                      <Link href={`/admin/members/${p.id}`} className="hover:underline">
                        {p.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
              <details>
                <summary className={`${quietLinkClass} cursor-pointer`}>Edit members</summary>
                <div className="mt-3">
                  <DepartmentMembersForm
                    action={setDepartmentMembersAction.bind(null, d.id)}
                    people={everyone.map((p) => ({ ...p, allowed: !onlyFor || p.tier === onlyFor }))}
                    inIt={d.members.map((p) => p.id)}
                    onlyFor={onlyFor}
                  />
                </div>
              </details>

              <details>
                <summary className={`${quietLinkClass} cursor-pointer`}>Rename or delete</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <DepartmentNameForm action={renameDepartmentAction.bind(null, d.id)} initial={d.name} label="Rename" />
                  {d.members.length === 0 && d.openTasks === 0 && (
                    <form action={deleteDepartmentAction.bind(null, d.id)}>
                      <button type="submit" className={dangerLinkClass}>
                        Delete {d.name}
                      </button>
                    </form>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      <details>
        <summary className={`${quietLinkClass} cursor-pointer`}>Add a department</summary>
        <div className="mt-3">
          <DepartmentNameForm action={createDepartmentAction} label="Add" />
        </div>
      </details>

      {without.length > 0 && <p className="text-sm text-muted">In no department: {without.map((p) => p.name).join(", ")}.</p>}
    </section>
  );
}
