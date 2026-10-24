// Shared task constants, safe to import from client components.
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const STATUS_LABELS: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

// Task fields an admin can edit. Editing one locks it against later sheet syncs.
export const EDITABLE_FIELDS = ["status", "assigneeId", "type", "dueDate"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const FIELD_LABELS: Record<EditableField | "title", string> = {
  title: "Title",
  status: "Status",
  assigneeId: "Assignee",
  type: "Type",
  dueDate: "Due date",
};
