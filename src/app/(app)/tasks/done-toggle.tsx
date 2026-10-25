"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useUndoToast } from "@/components/undo-toast";
import { secondaryButtonClass } from "@/components/ui";
import { setTaskDoneAction } from "./actions";

/**
 * Tick / untick a task. The same control undoes it, and a toast offers "Undo" for 8 seconds.
 * `variant`: a round check (lists) or a labelled button (task page).
 */
export function DoneToggle({ taskId, title, done, variant = "check" }: { taskId: number; title: string; done: boolean; variant?: "check" | "button" }) {
  const router = useRouter();
  const showToast = useUndoToast();
  const [pending, start] = useTransition();

  function set(next: boolean, offerUndo: boolean) {
    start(async () => {
      const result = await setTaskDoneAction(taskId, next);
      router.refresh();
      if (!result.ok) {
        showToast({ message: result.error ?? "Could not change the task." });
        return;
      }
      if (offerUndo) {
        showToast({
          message: next ? `Marked “${title}” as done.` : `Reopened “${title}”.`,
          undo: async () => {
            await setTaskDoneAction(taskId, !next);
            router.refresh();
          },
        });
      }
    });
  }

  if (variant === "button") {
    return (
      <button type="button" disabled={pending} onClick={() => set(!done, true)} className={secondaryButtonClass} aria-pressed={done}>
        {done ? "↺ Not done – reopen" : "✓ Mark as done"}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `“${title}” is done – untick to reopen` : `Mark “${title}” as done`}
      title={done ? "Done – tap to reopen" : "Mark as done"}
      disabled={pending}
      onClick={() => set(!done, true)}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-60 ${
        done ? "border-success-solid bg-success-solid text-on-primary hover:bg-success-solid-hover" : "border-line-strong text-subtle hover:border-success hover:bg-success-bg hover:text-success"
      }`}
    >
      ✓
    </button>
  );
}
