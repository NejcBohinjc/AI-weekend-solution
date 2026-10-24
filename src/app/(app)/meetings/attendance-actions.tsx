"use client";

import { useActionState } from "react";
import { errorClass, inputClass, secondaryButtonClass } from "@/components/ui";
import type { AttendanceState } from "@/lib/meetings/constants";
import type { AttendanceActionState } from "./actions";

type Props = {
  /** setMyAttendanceAction bound to the meeting id (on the server). */
  action: (prev: AttendanceActionState, formData: FormData) => Promise<AttendanceActionState>;
  current: AttendanceState | null;
  note: string | null;
  can: { checkIn: boolean; excuse: boolean };
  /** An admin recorded this member's attendance; only admins change it now. */
  lockedByAdmin: boolean;
};

/** The member's own buttons for one meeting: check in (present / remote), send an excuse, or take it back. */
export function AttendanceActions({ action, current, note, can, lockedByAdmin }: Props) {
  const [state, formAction, pending] = useActionState(action, {} as AttendanceActionState);

  if (lockedByAdmin) return <p className="text-sm text-muted">An admin recorded your attendance. Ask them if it needs changing.</p>;
  if (!can.checkIn && !can.excuse) return null;

  const checkedIn = current === "present" || current === "remote";
  return (
    <div className="flex flex-col gap-3">
      {can.checkIn && (
        <form action={formAction} className="grid grid-cols-2 gap-2">
          <button
            type="submit"
            name="intent"
            value="present"
            disabled={pending}
            aria-pressed={current === "present"}
            className={`rounded-xl px-4 py-4 text-base font-semibold shadow-sm transition disabled:opacity-60 ${current === "present" ? "bg-success-solid text-on-primary ring-2 ring-success-line" : "bg-success-solid text-on-primary hover:bg-success-solid-hover"}`}
          >
            {current === "present" ? "✓ I'm here" : "I'm here"}
          </button>
          <button
            type="submit"
            name="intent"
            value="remote"
            disabled={pending}
            aria-pressed={current === "remote"}
            className={`rounded-xl px-4 py-4 text-base font-semibold shadow-sm transition disabled:opacity-60 ${current === "remote" ? "bg-info-solid text-on-primary ring-2 ring-info-line" : "bg-info-solid text-on-primary hover:bg-info-solid"}`}
          >
            {current === "remote" ? "✓ Remote" : "Joining remotely"}
          </button>
        </form>
      )}

      {can.excuse && current !== "excused" && !checkedIn && (
        <details className="rounded-xl border border-line bg-surface px-4 py-3" open={state.error !== undefined && !can.checkIn}>
          <summary className="cursor-pointer text-sm font-medium">Can&apos;t come? Send an excuse</summary>
          <form action={formAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="intent" value="excused" />
            <textarea name="note" required minLength={3} maxLength={500} rows={2} placeholder="Reason, e.g. exam that afternoon" className={inputClass} />
            <button type="submit" disabled={pending} className={secondaryButtonClass}>
              {pending ? "Sending…" : "Send excuse"}
            </button>
          </form>
        </details>
      )}

      {current === "excused" && (
        <p className="text-sm text-fg-2">
          You sent an excuse{note ? `: “${note}”` : "."}
        </p>
      )}

      {(checkedIn || current === "excused") && (
        <form action={formAction}>
          <input type="hidden" name="intent" value="clear" />
          <button type="submit" disabled={pending} className="text-sm font-medium text-muted underline-offset-2 hover:underline">
            {current === "excused" ? "Take back my excuse" : "Undo check-in"}
          </button>
        </form>
      )}

      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state.done && !pending && (
        <p role="status" className="text-sm text-success">
          {state.done}
        </p>
      )}
    </div>
  );
}
