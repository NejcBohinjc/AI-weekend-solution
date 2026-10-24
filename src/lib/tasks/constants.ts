// Shared task constants, safe to import from client components.
// In workflow order. "verification": done by the assignee, waiting for someone to check it.
// Only "done" counts as finished; every other status (including verification) is open.
export const TASK_STATUSES = ["todo", "in_progress", "verification", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  verification: "Verifikacija",
  done: "Done",
};

// The task types offered in the app (form dropdown and filters). PLACEHOLDER list: replace it with the
// five most used "Tip taska" values (`npm run sheets:check -- --task-types` lists them). Types typed
// freely in the sheet are still imported as they are and keep showing.
export const TASK_TYPES = ["Marketing", "Events", "Finance", "Content", "Other"] as const;

// Task fields an admin can edit. Editing one locks it against later sheet syncs.
export const EDITABLE_FIELDS = ["status", "assigneeId", "type", "dueDate"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const FIELD_LABELS: Record<EditableField | "title" | "departmentId", string> = {
  title: "Title",
  status: "Status",
  assigneeId: "Assignee",
  departmentId: "Department",
  type: "Type",
  dueDate: "Due date",
};
