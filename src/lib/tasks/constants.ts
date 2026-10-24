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

// Priority tiers, most pressing first (lists sort in this order). New tasks are "medium".
export const TASK_PRIORITIES = ["urgent", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const DEFAULT_PRIORITY: TaskPriority = "medium";
export const PRIORITY_LABELS: Record<TaskPriority, string> = { urgent: "Urgent", medium: "Medium", low: "Low" };
/** 0 for urgent, 1 for medium, 2 for low: sorts the most pressing first. */
export const priorityRank = (p: TaskPriority | null | undefined): number => TASK_PRIORITIES.indexOf(p ?? DEFAULT_PRIORITY);

// Deadline reminders by email: days before the due date, sent at TASK_REMINDER_TIME (Europe/Ljubljana).
export const TASK_REMINDER_OPTIONS: { days: number; label: string }[] = [
  { days: 3, label: "3 days before" },
  { days: 1, label: "1 day before" },
  { days: 0, label: "On the due day" },
];
export const DEFAULT_TASK_REMINDER_DAYS = [1];
export const TASK_REMINDER_TIME = "08:00";

// The task types offered in the app (form dropdown and filters). PLACEHOLDER list: replace it with the
// five most used "Tip taska" values (`npm run sheets:check -- --task-types` lists them). Types typed
// freely in the sheet are still imported as they are and keep showing.
export const TASK_TYPES = ["Marketing", "Events", "Finance", "Content", "Other"] as const;

// Task fields an admin can edit. Editing one locks it against later sheet syncs.
export const EDITABLE_FIELDS = ["status", "assigneeId", "type", "dueDate"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const FIELD_LABELS: Record<EditableField | "title" | "departmentId" | "projectId" | "priority", string> = {
  title: "Title",
  status: "Status",
  assigneeId: "Assignee",
  departmentId: "Department",
  projectId: "Project",
  type: "Type",
  dueDate: "Due date",
  priority: "Priority",
};
