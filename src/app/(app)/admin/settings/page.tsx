import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { members, tasks } from "@/db/schema";
import { TIMEZONE } from "@/lib/app";
import { requireAdmin } from "@/lib/auth";
import { aiConfirmationSetting } from "@/lib/settings";
import { PageTitle } from "@/components/ui-kit";
import { AiConfirmationForm } from "./ai-confirmation-form";

export default async function AdminSettingsPage() {
  const [, setting, [waiting]] = await Promise.all([
    requireAdmin(),
    aiConfirmationSetting(),
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.createdByAi, true), isNull(tasks.aiConfirmedAt), isNull(tasks.deletedAt))),
  ]);
  const [by] = setting.updatedById ? await db.select({ name: members.name }).from(members).where(eq(members.id, setting.updatedById)) : [];

  return (
    <section className="flex max-w-2xl flex-col gap-8">
      <PageTitle accent="settings" sub="Choices that apply to the whole institute. Only admins see this page.">
        System
      </PageTitle>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card" data-testid="ai-confirmation">
        <h2 className="font-display text-lg font-semibold tracking-display">Do AI-created tasks need confirming?</h2>
        <p className="text-sm text-fg-2">
          Tasks the AI creates from meeting notes. Now: <strong>{setting.required ? "yes, the assignee confirms them" : "no, they count at once"}</strong>
          {setting.required && waiting.n > 0 ? ` · ${waiting.n} waiting for review` : ""}
          {setting.updatedAt
            ? ` · changed ${setting.updatedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE })}${by ? ` by ${by.name}` : ""}`
            : " (the default)"}
          .
        </p>
        <AiConfirmationForm required={setting.required} waiting={waiting.n} />
      </div>
    </section>
  );
}
