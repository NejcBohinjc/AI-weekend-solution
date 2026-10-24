"use client";

import { useActionState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { STATUS_LABELS, TASK_STATUSES, TASK_TYPES } from "@/lib/tasks/constants";
import type { TaskFormState, TaskFormValues } from "./actions";

type Props = {
  action: (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  initial: TaskFormValues;
  members: { id: number; name: string }[];
  submitLabel: string;
};

/** Create or edit a task. Changing the assignee hands the task over. */
export function TaskForm({ action, initial, members, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const values = state.values ?? initial;
  const extraType = initial.type && !(TASK_TYPES as readonly string[]).includes(initial.type) ? initial.type : null;

  return (
    // key: remount with the submitted values after an error (React resets forms after an action).
    <form key={JSON.stringify(values)} action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Title</span>
        <input name="title" defaultValue={values.title} required maxLength={200} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Assignee</span>
          <select name="assigneeId" defaultValue={values.assigneeId} className={inputClass}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Status</span>
          <select name="status" defaultValue={values.status} className={inputClass}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Type</span>
          <select name="type" defaultValue={values.type} className={inputClass}>
            <option value="">No type</option>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {/* A type typed freely in the sheet stays selected, so saving never loses it. */}
            {extraType && <option value={extraType}>{extraType} (from the sheet)</option>}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Due date</span>
          <input name="dueDate" type="date" defaultValue={values.dueDate} className={inputClass} />
        </label>
      </div>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state.saved && !pending && (
        <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success">
          Saved. It goes to the sheet in a moment.
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
