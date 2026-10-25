"use client";

import { useActionState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { TASK_TYPES } from "@/lib/tasks/constants";
import type { GeneralFormState } from "./general-actions";

/** Add or edit a general task (admins). */
export function GeneralTaskForm({
  action,
  initial = { title: "", description: "", type: "" },
  submitLabel,
}: {
  action: (prev: GeneralFormState, formData: FormData) => Promise<GeneralFormState>;
  initial?: { title: string; description: string; type: string };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Title</span>
        <input name="title" defaultValue={initial.title} required maxLength={200} placeholder="e.g. Help with research for the grant" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>What it involves (optional)</span>
        <textarea name="description" defaultValue={initial.description} maxLength={1000} rows={2} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Type</span>
        <select name="type" defaultValue={initial.type} className={inputClass}>
          <option value="">No type</option>
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {state.error && <p className={errorClass}>{state.error}</p>}
      {state.saved && !pending && (
        <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success">
          Saved.
        </p>
      )}
      <button type="submit" disabled={pending} className={`${primaryButtonClass} self-start`}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
