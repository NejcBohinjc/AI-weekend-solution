import Link from "next/link";
import { TypeBadge } from "@/components/task-badges";
import { inputClass, secondaryButtonClass } from "@/components/ui";
import type { Task } from "@/db/schema";
import { GENERAL_TASK_ASSUMPTION } from "@/lib/absence-rules";
import { TIMEZONE } from "@/lib/app";
import { DoneToggle } from "../done-toggle";
import { assignGeneralTaskAction, removeGeneralTaskAction, updateGeneralTaskAction } from "../general-actions";
import { GeneralTaskForm } from "../general-form";

type Event = { id: number; createdAt: Date; kind: string; field: string | null; oldValue: string | null; newValue: string | null; actorName: string | null };

/**
 * A general task: a standing task one member does at a time. The one doing it marks it done (it is then
 * free again for the next person); admins assign it, edit it or remove it; everyone sees its history.
 * Who holds or picked a task can show who missed a meeting, so names are for admins only.
 */
export function GeneralTaskDetail({
  task,
  meId,
  isAdmin,
  assigneeName,
  members,
  helpers,
  events,
}: {
  task: Task;
  meId: number;
  isAdmin: boolean;
  assigneeName: string | null;
  members: { id: number; name: string }[];
  helpers: string[];
  events: Event[];
}) {
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  const mine = task.assigneeId === meId;
  const holder = task.assigneeId === null ? "Free: nobody is doing it now" : mine ? "Yours: mark it done when you have finished" : isAdmin ? `Assigned to ${assigneeName ?? "a former member"}` : "Someone is doing it now";
  // History lines that name who holds, picked or finished the task: names for admins only.
  const private_ = (e: Event) => !isAdmin && (e.kind === "picked" || e.kind === "completed" || (e.kind === "updated" && e.field === "assigneeId"));
  const line = (e: Event) => {
    if (private_(e)) return e.kind === "completed" ? "finished it; it is free for the next person" : e.kind === "picked" ? "picked this" : "changed who does it";
    if (e.kind === "updated") {
      const label = e.field === "assigneeId" ? "Assigned to" : e.field === "description" ? "Description" : e.field === "title" ? "Title" : e.field === "type" ? "Type" : e.field;
      return `${label}: ${e.oldValue ?? "nobody"} → ${e.newValue ?? "nobody"}`;
    }
    return e.newValue;
  };

  return (
    <section className="flex max-w-2xl flex-col gap-6" data-testid="general-task">
      <div className="flex flex-col gap-2">
        <Link href="/tasks?tab=general" className="text-sm text-subtle hover:text-fg">
          ← General tasks
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-display">{task.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2">General task</span>
          {task.type && <TypeBadge type={task.type} />}
          {helpers.length > 0 && <span className="text-muted">{isAdmin ? `Picked by ${helpers.join(", ")}` : `${helpers.length} helped`}</span>}
        </p>
        {task.description && <p className="whitespace-pre-line text-fg-2">{task.description}</p>}
        <p className="text-xs text-subtle">{GENERAL_TASK_ASSUMPTION}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card" data-testid="general-holder">
        <p className={`text-sm ${mine ? "font-semibold text-fg" : "text-fg-2"}`}>{holder}</p>
        {(mine || (isAdmin && task.assigneeId !== null)) && (
          <div className="flex flex-wrap items-center gap-2">
            <DoneToggle taskId={task.id} title={task.title} done={false} variant="button" general />
            {!mine && <span className="text-xs text-subtle">(marks it done for them)</span>}
          </div>
        )}
        {isAdmin && (
          <form action={assignGeneralTaskAction.bind(null, task.id)} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Who does it</span>
              <select name="assigneeId" defaultValue={task.assigneeId ?? ""} className={`${inputClass} py-2`}>
                <option value="">Nobody (free)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Save
            </button>
          </form>
        )}
      </div>

      {isAdmin && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="font-semibold">Edit</h2>
          <GeneralTaskForm
            action={updateGeneralTaskAction.bind(null, task.id)}
            initial={{ title: task.title, description: task.description ?? "", type: task.type ?? "" }}
            submitLabel="Save"
          />
          <form action={removeGeneralTaskAction.bind(null, task.id)} className="border-t border-line pt-3">
            <button type="submit" className="text-sm font-medium text-danger hover:underline">
              Remove this general task
            </button>
          </form>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">History</h2>
        <ol className="flex flex-col gap-2 border-l-2 border-line pl-4 text-sm" data-testid="task-history">
          {events.map((e) => (
            <li key={e.id}>
              <span className="text-subtle">{fmt(e.createdAt)} · </span>
              <span className="font-medium">{private_(e) ? "A member" : (e.actorName ?? "")}</span>
              {": "}
              {line(e)}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
