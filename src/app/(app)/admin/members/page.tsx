import { and, asc, desc, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { AdminBadge, TierBadge } from "@/components/badges";
import { db } from "@/db";
import { members, passwordTokens } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { AccessStatus } from "./access-status";

export default async function MembersPage() {
  await requireAdmin();
  const [rows, pending] = await Promise.all([
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
  ]);
  const pendingIds = new Set(pending.map((p) => p.memberId));
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-sm text-muted">
            {activeCount} active{rows.length > activeCount && `, ${rows.length - activeCount} deactivated`}
          </p>
        </div>
        <Link
          href="/admin/members/new"
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
        >
          Add member
        </Link>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        {rows.map((m) => (
          <li key={m.id}>
            <Link
              href={`/admin/members/${m.id}`}
              className={`flex flex-col gap-1 px-4 py-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-3 ${m.active ? "" : "opacity-60"}`}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{m.name}</span>
                <span className="truncate text-sm text-subtle">{m.email}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {m.isAdmin && <AdminBadge />}
                <TierBadge tier={m.tier} />
                <span className="text-xs text-subtle">{m.weeklyHours} h/wk</span>
                <AccessStatus active={m.active} hasPassword={!!m.passwordHash} linkPending={pendingIds.has(m.id)} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
