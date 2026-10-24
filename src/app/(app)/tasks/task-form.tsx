"use client";

import { useActionState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "@/lib/tasks/constants";
import type { TaskFormState, TaskFormValues } from "./actions";

type Props = {
  action: (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  initial: TaskFormValues;
  members: { id: number; name: string }[];
  departments: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  submitLabel: string;
};

/** Create or edit a task. Changing who it is assigned to (a person or a whole department) hands it over. */
export function TaskForm({ action, initial, members, departments, projects, submitLabel }: Props) {
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
          <span className={labelClass}>Assigned to</span>
          <select name="owner" defaultValue={values.owner} className={inputClass}>
            <option value="">Unassigned</option>
            {departments.length > 0 && (
              <optgroup label="A whole department">
                {departments.map((d) => (
                  <option key={d.id} value={`d:${d.id}`}>
                    {d.name} (department)
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="One person">
              {members.map((m) => (
                <option key={m.id} value={`m:${m.id}`}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Project</span>
          <select name="projectId" defaultValue={values.projectId} className={inputClass}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
          <span className={labelClass}>Priority</span>
          <select name="priority" defaultValue={values.priority} className={inputClass}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
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
