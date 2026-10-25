"use client";

import { useActionState } from "react";
import { dangerLinkClass } from "@/components/ui";
import type { DeleteSeriesState } from "./actions";

type Props = { action: (prev: DeleteSeriesState) => Promise<DeleteSeriesState>; series: string; meetings: number; attendance: number };

/** Two steps, because deleting a series cannot be undone (its attendance goes with it). */
export function DeleteSeriesButton({ action, series, meetings, attendance }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  if (state?.done) {
    return (
      <p role="status" className="text-sm text-success">
        {state.done}
      </p>
    );
  }
  return (
    <details>
      <summary className={`${dangerLinkClass} cursor-pointer`}>Delete series</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <span className="text-xs text-fg-2">
          Deletes {meetings} meeting{meetings === 1 ? "" : "s"} of “{series}”
          {attendance ? ` with ${attendance} attendance record${attendance === 1 ? "" : "s"}` : ""}, their notes and reminders, and withdraws their
          Slack announcements. This cannot be undone. If the series is still in the calendar, the next import brings its meetings back.
        </span>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 self-start whitespace-nowrap rounded-pill bg-danger-solid px-4 py-2 font-display text-sm font-semibold text-on-primary transition hover:bg-danger-solid-hover disabled:opacity-60"
        >
          {pending ? "Deleting…" : `Delete “${series}” for good`}
        </button>
        {state?.error && (
          <span role="alert" className="text-xs text-danger">
            {state.error}
          </span>
        )}
      </form>
    </details>
  );
}
