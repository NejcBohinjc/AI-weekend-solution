import type { Task } from "@/db/schema";

export type SheetState = "synced" | "pending" | "removed";
const FIELDS = ["title", "status", "assigneeId", "type", "dueDate"] as const;

/**
 * Whether the sheet has this task as the app does: "pending" until the sync has written it (a new
 * task, or a change made in the app), "removed" when its row was deleted in the sheet.
 */
export function sheetState(task: Pick<Task, (typeof FIELDS)[number] | "sheetSnapshot" | "inSheet" | "source">): SheetState {
  if (!task.inSheet) return "removed";
  // Tasks from the earlier read-only import have no snapshot yet; their row is in the sheet.
  if (!task.sheetSnapshot) return task.source === "app" ? "pending" : "synced";
  return FIELDS.some((f) => task.sheetSnapshot![f] !== task[f]) ? "pending" : "synced";
}
