import Link from "next/link";
import { requireMember } from "@/lib/auth";

export default async function ForbiddenPage() {
  const member = await requireMember();
  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-warning">403 · Admins only</p>
      <h1 className="font-display text-3xl font-semibold tracking-display">You don’t have access to this page</h1>
      <p className="text-muted">
        You are signed in as <strong>{member.name}</strong>, who is not an admin. If you think you should have access, ask
        an admin to give you the admin role.
      </p>
      <Link href="/dashboard" className="self-start text-sm font-medium text-fg underline underline-offset-2">
        Back to dashboard
      </Link>
    </section>
  );
}
