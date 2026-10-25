import { ThemeSwitch } from "@/components/theme-switch";
import { cardClass } from "@/components/ui";
import { PageTitle, Section } from "@/components/ui-kit";
import { TierBadge } from "@/components/badges";
import { requireMember } from "@/lib/auth";
import { emailSettings } from "@/lib/email";
import { reminderSettingsFor } from "@/lib/meetings/queries";
import { taskReminderSettingsFor } from "@/lib/tasks/queries";
import { themePref } from "@/lib/theme-server";
import { ReminderSettingsForm } from "../meetings/reminder-settings-form";
import { TaskReminderSettingsForm } from "../tasks/task-reminder-settings-form";

export const dynamic = "force-dynamic";

/** The rarely used things in one place: how the app looks and which reminder emails you get. */
export default async function SettingsPage() {
  const me = await requireMember();
  const [meetingReminders, taskReminders, theme] = await Promise.all([reminderSettingsFor(me.id), taskReminderSettingsFor(me.id), themePref()]);
  const sending = emailSettings().sending;
  return (
    <section className="flex max-w-2xl flex-col gap-10">
      <PageTitle accent="settings" sub="How the app looks and which emails you get.">
        Your
      </PageTitle>

      <Section n={1} title="You">
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <p className="font-display text-lg font-semibold">{me.name}</p>
            <p className="text-sm text-muted">{me.email}</p>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted">
            <TierBadge tier={me.tier} /> {me.weeklyHours} hours a week
          </p>
        </div>
      </Section>

      <Section n={2} title="Appearance">
        <div className={`${cardClass} flex items-center justify-between gap-3`}>
          <p className="text-sm text-fg-2">Theme</p>
          <ThemeSwitch initial={theme} showLabels />
        </div>
      </Section>

      <Section n={3} title="Meeting reminders">
        <ReminderSettingsForm email={me.email} emailEnabled={meetingReminders.emailEnabled} minutesBefore={meetingReminders.minutesBefore} sending={sending} />
      </Section>

      <Section n={4} title="Deadline reminders">
        <TaskReminderSettingsForm email={me.email} enabled={taskReminders.enabled} daysBefore={taskReminders.daysBefore} sending={sending} />
      </Section>
    </section>
  );
}
