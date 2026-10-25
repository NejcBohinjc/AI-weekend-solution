import { and, asc, desc, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { AdminBadge, TierBadge } from "@/components/badges";
import { PageTitle, PrimaryLink, Section } from "@/components/ui-kit";
import { db } from "@/db";
import { members, passwordTokens } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { departmentNamesByMember } from "@/lib/departments";
import { AccessStatus } from "./access-status";

export default async function MembersPage() {
  const [, rows, pending, departmentsOf] = await Promise.all([
    requireAdmin(),
    db
      .select({
        id: members.id,
        name: members.name,
        email: members.email,
        tier: members.tier,
        weeklyHours: members.weeklyHours,
        isAdmin: members.isAdmin,
        active: members.active,
        passwordHash: members.passwordHash,
      })
      .from(members)
      .orderBy(desc(members.active), asc(members.name)),
    db
      .select({ memberId: passwordTokens.memberId })
      .from(passwordTokens)
      .where(and(isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, new Date()))),
    departmentNamesByMember(),
  ]);
  const pendingIds = new Set(pending.map((p) => p.memberId));
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <PageTitle accent="members" sub={`${activeCount} active${rows.length > activeCount ? `, ${rows.length - activeCount} deactivated` : ""}`}>
        Our
      </PageTitle>
      <Section n={1} title="Everyone" action={<PrimaryLink href="/admin/members/new">Add member</PrimaryLink>}>
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {rows.map((m) => (
            <li key={m.id}>
              <Link
                href={`/admin/members/${m.id}`}
                className={`flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2 sm:px-5 ${m.active ? "" : "opacity-60"}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-display font-semibold tracking-display">{m.name}</span>
                  <span className="truncate text-sm text-muted">
                    {m.weeklyHours} h/wk
                    {(departmentsOf.get(m.id) ?? []).length > 0 && ` · ${(departmentsOf.get(m.id) ?? []).join(", ")}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                  {m.isAdmin && <AdminBadge />}
                  <TierBadge tier={m.tier} />
                  {/* Only what needs a look: "can sign in" is the normal case and not repeated on every row. */}
                  {!(m.active && m.passwordHash) && <AccessStatus active={m.active} hasPassword={!!m.passwordHash} linkPending={pendingIds.has(m.id)} />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
