"use client";

import { useActionState } from "react";
import { errorClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import type { ProjectFormState } from "./actions";

type Action = (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;

/** Name and optional description: adds a project (no `initial`) or edits one. */
export function ProjectForm({ action, initial, submitLabel }: { action: Action; initial?: { name: string; description: string | null }; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          defaultValue={initial?.name}
          required
          maxLength={80}
          placeholder="Project name, e.g. Summer School 2027"
          aria-label="Project name"
          className={`${inputClass} py-2 sm:flex-1`}
        />
        <input
          name="description"
          defaultValue={initial?.description ?? ""}
          maxLength={300}
          placeholder="Short description (optional)"
          aria-label="Description"
          className={`${inputClass} py-2 sm:flex-[2]`}
        />
        <button type="submit" disabled={pending} className={`${initial ? secondaryButtonClass : primaryButtonClass} shrink-0 py-2`}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state.saved && !pending && (
        <p role="status" className="text-sm text-success">
          Saved.
        </p>
      )}
    </form>
  );
}
