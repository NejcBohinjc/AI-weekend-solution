"use client";

import { useActionState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import type { EntryFormState } from "./actions";
import { LocationToggle } from "./location-toggle";

type Props = {
  action: (prev: EntryFormState, formData: FormData) => Promise<EntryFormState>;
  defaults: { date: string; start: string; end: string; location: string };
  returnTo: string;
  submitLabel: string;
  /** Earliest date the viewer may pick (members: this week's Monday). */
  minDate?: string;
  maxDate: string;
};

export function EntryForm({ action, defaults, returnTo, submitLabel, minDate, maxDate }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? defaults;
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Date</span>
        <input type="date" name="date" required defaultValue={values.date} min={minDate} max={maxDate} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Start</span>
          <input type="time" name="start" required defaultValue={values.start} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>End</span>
          <input type="time" name="end" required defaultValue={values.end} className={inputClass} />
        </label>
      </div>
      <p className="text-xs text-subtle">An end time earlier than the start means you worked past midnight.</p>
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Where</span>
        {/* key: show the submitted choice again after an error */}
        <LocationToggle key={values.location} defaultValue={values.location} allowUnspecified={defaults.location === "unspecified"} />
      </div>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
