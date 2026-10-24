"use server";

import { and, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { members, passwordTokens, TIER_HOURS, TIERS } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { invalidateMemberSessions } from "@/lib/auth/sessions";
import { createSetupLink } from "@/lib/auth/setup-links";

export type MemberValues = { name: string; email: string; tier: string; weeklyHours: string; isAdmin: boolean };
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
  isAdmin: z.boolean(),
});

function readValues(formData: FormData): MemberValues {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    tier: String(formData.get("tier") ?? ""),
    weeklyHours: String(formData.get("weeklyHours") ?? ""),
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
  const { weeklyHours, ...rest } = parsed.data;
  const hours = weeklyHours === "" ? TIER_HOURS[rest.tier] : Number(weeklyHours);
  if (hours > 168) return { values, errors: { weeklyHours: "A week has 168 hours." } };

  const [clash] = await db
    .select({ id: members.id })
    .from(members)
    .where(excludeId ? and(eq(members.email, rest.email), ne(members.id, excludeId)) : eq(members.email, rest.email))
    .limit(1);
  if (clash) return { values, errors: { email: "Another member already uses this email." } };

  return { data: { ...rest, weeklyHours: hours } };
}

export async function createMemberAction(_prev: MemberFormState, formData: FormData): Promise<MemberFormState> {
  await requireAdmin();
  const result = await parseMember(formData);
  if (!result.data) return { errors: result.errors, values: result.values };

  const [member] = await db.insert(members).values(result.data).returning({ id: members.id, name: members.name });
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

  await db
    .update(members)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(members.id, id));
  revalidatePath("/admin/members");
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
