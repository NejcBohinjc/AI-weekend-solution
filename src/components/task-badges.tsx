import { TIMEZONE } from "@/lib/app";
import { STATUS_LABELS, type TaskStatus } from "@/lib/tasks/constants";

const STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-blue-50 text-blue-700 ring-blue-200",
  verification: "bg-orange-50 text-orange-800 ring-orange-300",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return <span className="inline-flex rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">{type}</span>;
}

/** "15 Nov" (adds the year when it is not this year); red when overdue and not done. */
export function DueDate({ date, today, done }: { date: string; today: string; done: boolean }) {
  const d = new Date(`${date}T12:00:00Z`);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric", timeZone: TIMEZONE });
  const overdue = !done && date < today;
  return (
    <span className={`text-xs ${overdue ? "font-semibold text-red-700" : "text-slate-600"}`}>
      {overdue ? "Overdue · " : "Due "}
      {label}
    </span>
  );
}
