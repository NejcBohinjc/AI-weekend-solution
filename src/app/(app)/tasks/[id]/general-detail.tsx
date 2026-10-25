import Link from "next/link";
import { TypeBadge } from "@/components/task-badges";
import type { Task } from "@/db/schema";
import { GENERAL_TASK_ASSUMPTION } from "@/lib/absence-rules";
import { TIMEZONE } from "@/lib/app";
import { removeGeneralTaskAction, updateGeneralTaskAction } from "../general-actions";
import { GeneralTaskForm } from "../general-form";

type Event = { id: number; createdAt: Date; kind: string; field: string | null; oldValue: string | null; newValue: string | null; actorName: string | null };

/** A general task: standing, never done. Admins edit or remove it; everyone sees its history. */
export function GeneralTaskDetail({ task, isAdmin, helpers, events }: { task: Task; isAdmin: boolean; helpers: string[]; events: Event[] }) {
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  return (
    <section className="flex max-w-2xl flex-col gap-6" data-testid="general-task">
      <div className="flex flex-col gap-2">
        <Link href="/tasks?tab=general" className="text-sm text-subtle hover:text-fg">
          ← General tasks
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-display">{task.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2">General task · never done</span>
          {task.type && <TypeBadge type={task.type} />}
          {/* Who picked it shows who missed a meeting: names for admins only. */}
          {helpers.length > 0 && <span className="text-muted">{isAdmin ? `Picked by ${helpers.join(", ")}` : `${helpers.length} helping`}</span>}
        </p>
        {task.description && <p className="whitespace-pre-line text-fg-2">{task.description}</p>}
        <p className="text-xs text-subtle">{GENERAL_TASK_ASSUMPTION}</p>
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
              <span className="font-medium">{isAdmin || e.kind !== "picked" ? (e.actorName ?? "") : "A member"}</span>
              {": "}
              {e.kind === "updated" ? `${e.field}: ${e.oldValue ?? "empty"} → ${e.newValue ?? "empty"}` : isAdmin || e.kind !== "picked" ? e.newValue : "picked this"}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
