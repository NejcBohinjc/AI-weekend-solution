"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import type { HoursSheetResult } from "@/lib/hours/sheet-sync";
import { retryHoursSheetAction } from "../../hours/actions";

/** Shows whether every finished entry is in the "Ure dela" tab, with a button to send the rest now. */
export function SheetPanel({ tab, pending, failed, lastError }: { tab: string; pending: number; failed: number; lastError: string | null }) {
  const [result, formAction, busy] = useActionState(retryHoursSheetAction, null as HoursSheetResult | null);
  const error = result ? result.error : lastError;

  return (
    <section aria-label="Google Sheets" className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Google Sheets · “{tab}”</h2>
          <p className="text-xs text-subtle">
            {result
              ? `Sent ${result.synced} ${result.synced === 1 ? "entry" : "entries"}${result.failed ? `, ${result.failed} failed` : ""}.`
              : pending
                ? `${pending} ${pending === 1 ? "entry is" : "entries are"} not synced to the sheet${failed ? ` (${failed} with errors)` : ""}.`
                : "Every finished entry is in the sheet."}{" "}
            Each entry is written when the timer stops.
          </p>
        </div>
        {(pending > 0 || result || lastError) && (
          <form action={formAction}>
            <button type="submit" disabled={busy} className={secondaryButtonClass}>
              {busy ? "Retrying…" : "Retry sync to sheet"}
            </button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
          <span className="font-semibold">Last error: </span>
          {error}
        </p>
      )}
    </section>
  );
}
