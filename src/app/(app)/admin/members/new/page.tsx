import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { departmentList } from "@/lib/departments";
import { createMemberAction } from "../actions";
import { MemberForm } from "../member-form";

export default async function NewMemberPage() {
  await requireAdmin();
  const departmentOptions = await departmentList();
  return (
    <section className="flex max-w-lg flex-col gap-4">
      <Link href="/admin/members" className="text-sm text-subtle hover:text-fg">
        ← Members
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Add member</h1>
      <p className="text-sm text-muted">You get a one-time setup link to send them. They choose their own password.</p>
      <MemberForm
        action={createMemberAction}
        initial={{ name: "", email: "", tier: "", weeklyHours: "", departmentId: "", isAdmin: false }}
        departments={departmentOptions}
        submitLabel="Add member"
      />
    </section>
  );
}
