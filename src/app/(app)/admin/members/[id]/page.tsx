import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { secondaryButtonClass } from "@/components/ui";
import { db } from "@/db";
import { members, passwordTokens } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireAdmin } from "@/lib/auth";
import { AccessStatus } from "../access-status";
import { generateLinkAction, setActiveAction, updateMemberAction } from "../actions";
import { MemberForm } from "../member-form";
import { SetupLinkButton } from "../setup-link-button";

const NOTICES: Record<string, string> = {
  "1": "Changes saved.",
  deactivated: "Member deactivated. They have been signed out everywhere and cannot sign in.",
  reactivated: "Member reactivated. They can sign in with their existing password.",
};

export default async function EditMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const admin = await requireAdmin();
  const [{ id: rawId }, { saved, error }] = await Promise.all([params, searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  const [[member], [pendingLink]] = await Promise.all([
    db.select().from(members).where(eq(members.id, id)).limit(1),
    db
      .select({ expiresAt: passwordTokens.expiresAt })
      .from(passwordTokens)
      .where(and(eq(passwordTokens.memberId, id), isNull(passwordTokens.usedAt), gt(passwordTokens.expiresAt, new Date())))
      .limit(1),
  ]);
  if (!member) notFound();
  const isSelf = member.id === admin.id;

  return (
    <section className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/members" className="text-sm text-slate-500 hover:text-slate-900">
          ← Members
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{member.name}</h1>
        {saved && NOTICES[saved] && (
          <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {NOTICES[saved]}
          </p>
        )}
        {error === "self-deactivate" && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            You cannot deactivate yourself. Ask another admin.
          </p>
        )}
      </div>

      <MemberForm
        action={updateMemberAction.bind(null, member.id)}
        initial={{
          name: member.name,
          email: member.email,
          tier: member.tier,
          weeklyHours: String(member.weeklyHours),
          isAdmin: member.isAdmin,
        }}
        submitLabel="Save changes"
        isSelf={isSelf}
      />

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Access</h2>
          <AccessStatus active={member.active} hasPassword={!!member.passwordHash} linkPending={!!pendingLink} />
        </div>
        {member.active && (
          <>
            <p className="text-sm text-slate-600">
              {member.passwordHash ? "Has a password." : "Has no password yet."}
              {pendingLink &&
                ` An unused link expires ${pendingLink.expiresAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE })}.`}{" "}
              A new link cancels earlier ones. Their current password keeps working until they set a new one.
            </p>
            <SetupLinkButton action={generateLinkAction.bind(null, member.id)} hasPassword={!!member.passwordHash} />
          </>
        )}
        {!isSelf && (
          <form action={setActiveAction.bind(null, member.id, !member.active)} className="border-t border-slate-100 pt-4">
            <p className="mb-3 text-sm text-slate-600">
              {member.active
                ? "Deactivating signs them out everywhere and blocks sign-in. Their history is kept."
                : "This member is deactivated and cannot sign in."}
            </p>
            <button
              type="submit"
              className={member.active ? `${secondaryButtonClass} text-red-700` : secondaryButtonClass}
            >
              {member.active ? "Deactivate member" : "Reactivate member"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
