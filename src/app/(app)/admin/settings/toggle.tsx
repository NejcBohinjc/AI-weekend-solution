"use client";

import { useActionState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { setAutoConfirmAction, type SettingsState } from "./actions";

/** One switch: submits the opposite of what is set now. */
export function AutoConfirmToggle({ on }: { on: boolean }) {
  const [state, formAction, pending] = useActionState(setAutoConfirmAction, null as SettingsState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="on" value={String(!on)} />
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-pill px-3 py-1 text-xs font-semibold ${on ? "bg-success-bg text-success" : "bg-surface-3 text-fg-2"}`}
          data-testid="auto-confirm-state"
        >
          {on ? "On: AI tasks count straight away" : "Off: the assignee confirms first"}
        </span>
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Saving…" : on ? "Turn confirming back on" : "Turn confirming off"}
        </button>
      </div>
      {state?.done && (
        <p role="status" className="text-sm text-success">
          {state.done}
        </p>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
