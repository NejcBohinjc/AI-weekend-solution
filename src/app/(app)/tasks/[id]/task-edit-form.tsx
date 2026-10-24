"use client";

import { useActionState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { FIELD_LABELS, STATUS_LABELS, TASK_STATUSES, type EditableField, type TaskStatus } from "@/lib/tasks/constants";
import type { TaskEditState } from "../actions";

type Props = {
  action: (prev: TaskEditState, formData: FormData) => Promise<TaskEditState>;
  task: { status: TaskStatus; assigneeId: number | null; type: string | null; dueDate: string | null; lockedFields: string[] };
  members: { id: number; name: string }[];
  fromSheet: boolean;
};

export function TaskEditForm({ action, task, members, fromSheet }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const lockNote = (field: EditableField) =>
    fromSheet && task.lockedFields.includes(field) ? (
      <span className="text-xs font-normal text-slate-500"> · edited here, sync keeps it</span>
    ) : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>
            {FIELD_LABELS.status}
            {lockNote("status")}
          </span>
          <select name="status" defaultValue={task.status} className={inputClass}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>
            {FIELD_LABELS.assigneeId}
            {lockNote("assigneeId")}
          </span>
          <select name="assigneeId" defaultValue={task.assigneeId ?? ""} className={inputClass}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>
            {FIELD_LABELS.type}
            {lockNote("type")}
          </span>
          <input name="type" defaultValue={task.type ?? ""} placeholder="e.g. marketing" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>
            {FIELD_LABELS.dueDate}
            {lockNote("dueDate")}
          </span>
          <input name="dueDate" type="date" defaultValue={task.dueDate ?? ""} className={inputClass} />
        </label>
      </div>
      {fromSheet && (
        <p className="text-xs text-slate-500">Fields you change here are kept: later syncs from the sheet will not overwrite them.</p>
      )}
      {state.error && <p className={errorClass}>{state.error}</p>}
      {state.saved && !pending && (
        <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Saved.
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : "Save task"}
      </button>
    </form>
  );
}
