"use server";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { departments, memberDepartments, members, passwordTokens, TIER_HOURS, TIERS } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { invalidateMemberSessions } from "@/lib/auth/sessions";
import { createSetupLink } from "@/lib/auth/setup-links";
import { departmentTierProblem } from "@/lib/department-rules";

/** departmentIds: the ticked departments (any number, or none). */
export type MemberValues = { name: string; email: string; tier: string; weeklyHours: string; departmentIds: string[]; isAdmin: boolean };
type Field = keyof MemberValues;
export type MemberFormState = {
  errors?: Partial<Record<Field, string>>;
  values?: MemberValues;
  created?: { id: number; name: string; url: string; expiresAt: string };
};
export type SetupLinkState = { url?: string; expiresAt?: string; error?: string };

const memberSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100, "Use at most 100 characters."),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  tier: z.enum(TIERS, "Pick a tier."),
  weeklyHours: z.string().trim().regex(/^\d{0,3}$/, "Enter a whole number of hours."),
  departmentIds: z.array(z.string().regex(/^\d+$/, "Pick departments from the list.")),
  isAdmin: z.boolean(),
});

function readValues(formData: FormData): MemberValues {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    tier: String(formData.get("tier") ?? ""),
    weeklyHours: String(formData.get("weeklyHours") ?? ""),
    departmentIds: formData.getAll("departmentIds").map(String),
    isAdmin: formData.get("isAdmin") === "on",
  };
}

async function parseMember(formData: FormData, excludeId?: number) {
  const values = readValues(formData);
  const parsed = memberSchema.safeParse(values);
  if (!parsed.success) {
    const errors: MemberFormState["errors"] = {};
    for (const issue of parsed.error.issues) errors[issue.path[0] as Field] ??= issue.message;
    return { values, errors };
  }
  const { weeklyHours, departmentIds: rawDepartments, ...rest } = parsed.data;
  const hours = weeklyHours === "" ? TIER_HOURS[rest.tier] : Number(weeklyHours);
  if (hours > 168) return { values, errors: { weeklyHours: "A week has 168 hours." } };
  const departmentIds = [...new Set(rawDepartments.map(Number))];
  const chosen = departmentIds.length
    ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, departmentIds))
    : [];
  if (chosen.length !== departmentIds.length) return { values, errors: { departmentIds: "A department no longer exists. Reload the page." } };
  const tierProblem = departmentTierProblem(chosen, rest.tier);
  if (tierProblem) return { values, errors: { departmentIds: tierProblem } };

  const [clash] = await db
    .select({ id: members.id })
    .from(members)
    .where(excludeId ? and(eq(members.email, rest.email), ne(members.id, excludeId)) : eq(members.email, rest.email))
    .limit(1);
  if (clash) return { values, errors: { email: "Another member already uses this email." } };

  return { data: { ...rest, weeklyHours: hours }, departmentIds };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replaces a member's departments with exactly these. */
async function setDepartments(tx: Tx, memberId: number, departmentIds: number[]) {
  await tx.delete(memberDepartments).where(eq(memberDepartments.memberId, memberId));
  if (departmentIds.length) await tx.insert(memberDepartments).values(departmentIds.map((departmentId) => ({ memberId, departmentId })));
}

export async function createMemberAction(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  await requireAdmin();
  const result = await parseMember(formData);
  if (!result.data) return { errors: result.errors, values: result.values };

  const member = await db.transaction(async (tx) => {
    const [m] = await tx.insert(members).values(result.data).returning({ id: members.id, name: members.name });
    await setDepartments(tx, m.id, result.departmentIds);
    return m;
  });
  const link = await createSetupLink(member.id);
  revalidatePath("/admin/members");
  return { created: { id: member.id, name: member.name, url: link.url, expiresAt: link.expiresAt.toISOString() } };
}

export async function updateMemberAction(id: number, _prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  const admin = await requireAdmin();
  const result = await parseMember(formData, id);
  if (!result.data) return { errors: result.errors, values: result.values };
  if (id === admin.id && !result.data.isAdmin) {
    return { values: readValues(formData), errors: { isAdmin: "You cannot remove your own admin role. Ask another admin." } };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(members)
      .set({ ...result.data, updatedAt: new Date() })
      .where(eq(members.id, id));
    await setDepartments(tx, id, result.departmentIds);
  });
  revalidatePath("/admin/members");
  revalidatePath("/admin/departments");
  redirect(`/admin/members/${id}?saved=1`);
}

export async function setActiveAction(id: number, active: boolean) {
  const admin = await requireAdmin();
  if (id === admin.id && !active) redirect(`/admin/members/${id}?error=self-deactivate`);

  await db.update(members).set({ active, updatedAt: new Date() }).where(eq(members.id, id));
  if (!active) {
    await invalidateMemberSessions(id);
    await db.delete(passwordTokens).where(and(eq(passwordTokens.memberId, id), isNull(passwordTokens.usedAt)));
  }
  revalidatePath("/admin/members");
  redirect(`/admin/members/${id}?saved=${active ? "reactivated" : "deactivated"}`);
}

export async function generateLinkAction(id: number, _prev: SetupLinkState): Promise<SetupLinkState> {
  await requireAdmin();
  const [member] = await db.select({ active: members.active }).from(members).where(eq(members.id, id)).limit(1);
  if (!member) return { error: "Member not found." };
  if (!member.active) return { error: "Reactivate this member first." };
  const link = await createSetupLink(id);
  revalidatePath(`/admin/members/${id}`);
  return { url: link.url, expiresAt: link.expiresAt.toISOString() };
}
