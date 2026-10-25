"use client";

import { useActionState, useState } from "react";
import { secondaryButtonClass } from "@/components/ui";
import { saveAiConfirmationAction, type SettingsState } from "./actions";

/** The switch: do AI-created tasks wait for the assignee to confirm them? */
export function AiConfirmationForm({ required, waiting }: { required: boolean; waiting: number }) {
  const [state, formAction, pending] = useActionState(saveAiConfirmationAction, null as SettingsState);
  const [choice, setChoice] = useState(required ? "on" : "off");
  const option = (value: "on" | "off", title: string, hint: string) => (
    <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${choice === value ? "border-brand bg-surface-2" : "border-line bg-surface"}`}>
      <input type="radio" name="aiConfirmation" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1 size-4" />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <form action={formAction} className="flex flex-col gap-3" aria-label="Confirming AI-created tasks">
      {option(
        "on",
        "Yes, the assignee confirms them",
        "AI-created tasks are marked AI and wait for review: they count (in numbers, reminders and analytics) once the assignee confirms them.",
      )}
      {option("off", "No, they count at once", "AI-created tasks are still marked AI, but count from the moment they are created. Nobody is asked to review them.")}
      {choice === "off" && required && waiting > 0 && (
        <p className="text-sm text-warning">
          Saving this also accepts the {waiting} AI-created {waiting === 1 ? "task" : "tasks"} waiting for review now. Their history says so.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || choice === (required ? "on" : "off")} className={secondaryButtonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.message && !pending && (
          <span role="status" className="text-sm text-success">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
