import { TIMEZONE } from "@/lib/app";
import { PRIORITY_LABELS, STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/lib/tasks/constants";

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-surface-3 text-fg-2 ring-line",
  in_progress: "bg-accent-bg text-accent ring-accent-line",
  verification: "bg-orange-bg text-orange ring-orange-line",
  done: "bg-success-bg text-success ring-success-line",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// Only "urgent" stands out; medium (the default) and low stay quiet.
const PRIORITY_STYLES: Record<TaskPriority, string> = {
  urgent: "bg-danger-bg text-danger ring-danger-line font-semibold",
  medium: "bg-surface text-muted ring-line font-medium",
  low: "bg-surface text-subtle ring-line",
};
const PRIORITY_MARKS: Record<TaskPriority, string> = { urgent: "! ", medium: "", low: "↓ " };

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span title="Priority" className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${PRIORITY_STYLES[priority]}`}>
      {PRIORITY_MARKS[priority]}
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return <span className="inline-flex rounded-md bg-violet-bg px-1.5 py-0.5 text-xs font-medium text-violet">{type}</span>;
}

/** A task delegated to a whole department (or a member's department). */
export function DepartmentBadge({ name }: { name: string }) {
  return <span className="inline-flex rounded-full bg-info-bg px-2 py-0.5 text-xs font-medium text-info ring-1 ring-inset ring-info-line">{name}</span>;
}

/** "15 Nov" (adds the year when it is not this year); red when overdue and not done. */
export function DueDate({ date, today, done }: { date: string; today: string; done: boolean }) {
  const d = new Date(`${date}T12:00:00Z`);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: TIMEZONE });
  const overdue = !done && date < today;
  return (
    <span className={`text-xs ${overdue ? "font-semibold text-danger" : "text-muted"}`}>
      {overdue ? "Overdue · " : "Due "}
      {label}
    </span>
  );
}

/** Marks a task the AI created from meeting notes; "AI, confirmed" once the assignee accepted it. */
export function AiBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      title={confirmed ? "Created by AI from meeting notes, confirmed by the assignee" : "Created by AI from meeting notes, not yet confirmed"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${confirmed ? "bg-indigo-bg text-indigo ring-indigo-line" : "bg-violet-bg text-violet ring-violet-line"}`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2l2.4 6.9L21 11l-6.6 2.1L12 20l-2.4-6.9L3 11l6.6-2.1z" />
      </svg>
      {confirmed ? "AI, confirmed" : "AI"}
    </span>
  );
}
