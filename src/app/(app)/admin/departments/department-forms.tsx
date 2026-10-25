"use client";

import { useActionState } from "react";
import { errorClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { DepartmentFormState, DepartmentMembersState } from "./actions";

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

type MemberChoice = { id: number; name: string; tier: string; allowed: boolean };
type MembersAction = (prev: DepartmentMembersState, formData: FormData) => Promise<DepartmentMembersState>;

/**
 * Tick who is in this department. A department named like a tier ("Core") only takes members of that
 * tier, so the others are shown but cannot be ticked; the server checks the same rule.
 */
export function DepartmentMembersForm({ action, people, inIt, onlyFor }: { action: MembersAction; people: MemberChoice[]; inIt: number[]; onlyFor: string | null }) {
  const [state, formAction, pending] = useActionState(action, null as DepartmentMembersState);
  const chosen = new Set(inIt);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {onlyFor && <p className="text-xs text-subtle">Only members of the {onlyFor} tier can be in this department.</p>}
      <ul className="grid max-h-72 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
        {people.map((p) => (
          <li key={p.id}>
            <label className={`flex items-center gap-2 text-sm ${p.allowed ? "" : "text-subtle"}`}>
              <input
                type="checkbox"
                name="memberIds"
                value={p.id}
                defaultChecked={chosen.has(p.id)}
                disabled={!p.allowed}
                className="size-4 shrink-0 rounded border-line-strong accent-primary disabled:opacity-50"
              />
              <span className="min-w-0 truncate">
                {p.name} <span className="text-xs text-subtle">{p.tier}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Saving…" : "Save members"}
        </button>
        {state?.saved && (
          <p role="status" className="text-sm text-success">
            {state.saved}
          </p>
        )}
      </div>
      {state?.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
    </form>
  );
}
