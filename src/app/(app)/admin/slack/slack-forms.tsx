"use client";

import { useActionState } from "react";
import { errorClass, secondaryButtonClass } from "@/components/ui";
import type { SlackActionState } from "./actions";

type Action = (prev: SlackActionState, formData: FormData) => Promise<SlackActionState>;

/** A form around server-rendered fields, with the result of saving (and the Slack sync it starts). */
export function SlackForm({ action, submitLabel, children, label }: { action: Action; submitLabel: string; children?: React.ReactNode; label: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} aria-label={label} className="flex flex-col gap-3">
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Working…" : submitLabel}
        </button>
        {state?.summary && !pending && (
          <span role="status" className="text-sm text-success">
            {state.saved ? "Done. " : ""}
            {state.summary}.
          </span>
        )}
      </div>
      {state?.error && !pending && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
    </form>
  );
}
