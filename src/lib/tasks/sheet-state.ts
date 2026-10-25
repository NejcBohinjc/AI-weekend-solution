import type { Task } from "@/db/schema";

export type SheetState = "synced" | "pending" | "removed";
const FIELDS = ["title", "status", "assigneeId", "departmentId", "type", "dueDate", "priority"] as const;

/**
 * Whether the sheet has this task as the app does: "pending" until the sync has written it (a new
 * task, or a change made in the app), "removed" when its row was deleted in the sheet.
 */
export function sheetState(task: Pick<Task, (typeof FIELDS)[number] | "sheetSnapshot" | "inSheet" | "source">): SheetState {
  if (!task.inSheet) return "removed";
  // Tasks from the earlier read-only import have no snapshot yet; their row is in the sheet.
  if (!task.sheetSnapshot) return task.source === "app" ? "pending" : "synced";
  // Snapshots from before departments have no departmentId: that means none. An empty priority cell
  // (or a snapshot from before priorities) is filled by the next sync and does not count as pending.
  const snap = { ...task.sheetSnapshot, departmentId: task.sheetSnapshot.departmentId ?? null, priority: task.sheetSnapshot.priority ?? task.priority };
  return FIELDS.some((f) => snap[f] !== (task[f] ?? null)) ? "pending" : "synced";
}
