"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import type { ReminderRun } from "@/lib/meetings/reminders";
import { sendRemindersNowAction } from "./actions";

type Props = { sending: boolean; from: string | null; redirectTo: string | null; children: React.ReactNode };

/** Email status, a button to send due reminders now, and (children) the latest emails. */
export function RemindersPanel({ sending, from, redirectTo, children }: Props) {
  const [run, action, busy] = useActionState(sendRemindersNowAction, null as ReminderRun | null);
  return (
    <section aria-label="Reminders" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Email reminders</h2>
          <p className="text-xs text-slate-500">
            {sending
              ? `Sending from ${from ?? "the SMTP account"}${redirectTo ? `, all to ${redirectTo} (MAIL_REDIRECT_TO)` : ""}.`
              : "Not sending: SMTP is not set up, so reminders are only recorded below."}{" "}
            The scheduled job sends due reminders every few minutes.
          </p>
        </div>
        <form action={action}>
          <button type="submit" disabled={busy} className={secondaryButtonClass}>
            {busy ? "Sending…" : "Send due reminders now"}
          </button>
        </form>
      </div>
      {run && (
        <p role="status" className="text-sm text-slate-700">
          {run.ran ? `${run.emails} ${run.emails === 1 ? "email" : "emails"}: ${run.sent} sent, ${run.logged} recorded only, ${run.failed} failed.` : "Another run is busy; try again in a moment."}
        </p>
      )}
      {children}
    </section>
  );
}
