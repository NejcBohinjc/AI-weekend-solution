import { requireAdmin } from "@/lib/auth";
import { AUTO_CONFIRM_AI_TASKS, getFlag } from "@/lib/settings";
import { PageTitle, Section } from "@/components/ui-kit";
import { AutoConfirmToggle } from "./toggle";

export default async function AdminSettingsPage() {
  // The setting does not depend on who is asking, so it is read while the session is checked.
  const [, autoConfirm] = await Promise.all([requireAdmin(), getFlag(AUTO_CONFIRM_AI_TASKS)]);

  return (
    <section className="flex max-w-2xl flex-col gap-10">
      <PageTitle accent="settings" sub="Switches that apply to the whole institute.">
        Admin
      </PageTitle>

      <Section n={1} title="AI tasks">
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="font-display text-lg font-semibold tracking-display">Confirming AI tasks</h2>
          <p className="max-w-prose text-sm text-muted">
            A task that AI created from meeting notes normally waits for its assignee to confirm it, and does not count in
            anyone&apos;s numbers until they do. Turn confirming off when you trust the notes and want the tasks to count at once.
          </p>
          <AutoConfirmToggle on={autoConfirm} />
          <p className="text-xs text-subtle">
            This applies to AI tasks created from now on. Tasks already waiting keep their “AI” badge until someone confirms them.
          </p>
        </div>
      </Section>
    </section>
  );
}
