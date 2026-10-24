// What changes besides the status when a task is finished or reopened. Pure (tested in done.test.ts)
// and used by every path that changes a status: the app (tick, untick, edit form) and the sheet sync.
import type { TaskStatus } from "./constants";

type Before = { status: TaskStatus; statusBeforeDone: TaskStatus | null };

/**
 * The extra fields for a status change: finishing stamps the completion time and remembers the status
 * it had; reopening clears both. Null when the change does not cross "done".
 */
export function completionFields(before: Before, next: TaskStatus, now: Date): { completedAt: Date | null; statusBeforeDone: TaskStatus | null } | null {
  if (before.status !== "done" && next === "done") return { completedAt: now, statusBeforeDone: before.status };
  if (before.status === "done" && next !== "done") return { completedAt: null, statusBeforeDone: null };
  return null;
}

export function isReopen(from: TaskStatus, to: TaskStatus): boolean {
  return from === "done" && to !== "done";
}

/**
 * The status an unticked task goes back to: the one it had before it was marked done; if that is
 * unknown, "in progress" if it was ever started, else "to do".
 */
export function reopenStatus(statusBeforeDone: TaskStatus | null, everStarted: boolean): TaskStatus {
  if (statusBeforeDone && statusBeforeDone !== "done") return statusBeforeDone;
  return everStarted ? "in_progress" : "todo";
}
