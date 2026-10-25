"use client";

import { useActionState } from "react";
import { errorClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { DepartmentFormState } from "./actions";

type Action = (prev: DepartmentFormState, formData: FormData) => Promise<DepartmentFormState>;

/** A name field with a save button: adds a department, or renames one (`initial` set). */
export function DepartmentNameForm({ action, initial, label }: { action: Action; initial?: string; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          name="name"
          defaultValue={initial}
          required
          maxLength={40}
          placeholder="e.g. Marketing"
          aria-label={initial ? `Name of ${initial}` : "New department name"}
          className={`${inputClass} py-2`}
        />
        <button type="submit" disabled={pending} className={`${secondaryButtonClass} shrink-0`}>
          {pending ? "Saving…" : label}
        </button>
      </div>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
    </form>
  );
}
