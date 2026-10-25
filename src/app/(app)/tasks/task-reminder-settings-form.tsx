"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { TASK_REMINDER_OPTIONS, TASK_REMINDER_TIME } from "@/lib/tasks/constants";
import { saveTaskReminderSettingsAction, type TaskReminderSettingsState } from "./actions";

type Props = { email: string; enabled: boolean; daysBefore: number[]; sending: boolean };

export function TaskReminderSettingsForm({ email, enabled, daysBefore, sending }: Props) {
  const [state, formAction, pending] = useActionState(saveTaskReminderSettingsAction, {} as TaskReminderSettingsState);
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" aria-label="Deadline reminder settings">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-4" />
        Email me before my tasks are due
      </label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <legend className="mb-1 text-sm text-muted">When (at {TASK_REMINDER_TIME})</legend>
        {TASK_REMINDER_OPTIONS.map((o) => (
          <label key={o.days} className="flex items-center gap-1.5">
            <input type="checkbox" name="daysBefore" value={o.days} defaultChecked={daysBefore.includes(o.days)} className="size-4" />
            {o.label}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-subtle">
        Reminders go to {email}, for open tasks with a due date that are yours or your department&apos;s.
        {!sending && " Email sending is not set up yet, so reminders are only recorded for now."}
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Saving…" : "Save reminders"}
        </button>
        {state.saved && !pending && (
          <span role="status" className="text-sm text-success">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
