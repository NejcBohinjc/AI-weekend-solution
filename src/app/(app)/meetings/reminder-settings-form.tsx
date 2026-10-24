"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { REMINDER_OPTIONS } from "@/lib/meetings/constants";
import { saveReminderSettingsAction, type ReminderSettingsState } from "./actions";

type Props = { email: string; emailEnabled: boolean; minutesBefore: number[]; sending: boolean };

export function ReminderSettingsForm({ email, emailEnabled, minutesBefore, sending }: Props) {
  const [state, formAction, pending] = useActionState(saveReminderSettingsAction, {} as ReminderSettingsState);
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" aria-label="Reminder settings">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" name="emailEnabled" defaultChecked={emailEnabled} className="size-4" />
        Email me before my meetings
      </label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <legend className="mb-1 text-sm text-muted">When</legend>
        {REMINDER_OPTIONS.map((o) => (
          <label key={o.minutes} className="flex items-center gap-1.5">
            <input type="checkbox" name="minutesBefore" value={o.minutes} defaultChecked={minutesBefore.includes(o.minutes)} className="size-4" />
            {o.label}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-subtle">
        Reminders go to {email}. No reminder comes for a meeting you sent an excuse for.
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
