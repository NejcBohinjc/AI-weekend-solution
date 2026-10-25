"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import type { ReminderRun } from "@/lib/meetings/reminders";
import { sendRemindersNowAction, sendTestEmailAction, type TestEmailResult } from "./actions";

type Props = { sending: boolean; from: string | null; redirectTo: string | null; children: React.ReactNode };

/** Email status, a button to send due reminders now, and (children) the latest emails. */
export function RemindersPanel({ sending, from, redirectTo, children }: Props) {
  const [run, action, busy] = useActionState(sendRemindersNowAction, null as ReminderRun | null);
  const [test, testAction, testing] = useActionState(sendTestEmailAction, null as TestEmailResult | null);
  return (
    <section aria-label="Reminders" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Email reminders</h2>
          <p className="text-xs text-subtle">
            {sending
              ? `Sending from ${from ?? "the SMTP account"}${redirectTo ? `, all to ${redirectTo} (MAIL_REDIRECT_TO)` : ""}.`
              : "Not sending: SMTP is not set up, so reminders are only recorded below."}{" "}
            The scheduled job sends due reminders every few minutes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={testAction}>
            <button type="submit" disabled={testing} className={secondaryButtonClass}>
              {testing ? "Sending…" : "Send test email"}
            </button>
          </form>
          <form action={action}>
            <button type="submit" disabled={busy} className={secondaryButtonClass}>
              {busy ? "Sending…" : "Send due reminders now"}
            </button>
          </form>
        </div>
      </div>
      {test && (
        <p role="status" data-testid="test-email-result" className={`rounded-xl px-4 py-3 text-sm ${test.status === "failed" ? "bg-danger-bg text-danger" : test.status === "sent" ? "bg-success-bg text-success" : "bg-surface-2 text-fg-2"}`}>
          {test.status === "sent" && `Test email sent to ${test.to}. Check that inbox (and spam).`}
          {test.status === "logged" && `Nothing was sent: SMTP_HOST is not set, so the message to ${test.to} was only recorded below.`}
          {test.status === "failed" && `Sending to ${test.to} failed: ${test.error}`}
        </p>
      )}
      {run && (
        <p role="status" className="text-sm text-fg-2">
          {run.ran ? `${run.emails} ${run.emails === 1 ? "email" : "emails"}: ${run.sent} sent, ${run.logged} recorded only, ${run.failed} failed${run.deferred ? `, ${run.deferred} left for the next run` : ""}.` : "Another run is busy; try again in a moment."}
        </p>
      )}
      {children}
    </section>
  );
}
