import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import { TypeBadge } from "@/components/task-badges";
import { secondaryButtonClass } from "@/components/ui";
import { db } from "@/db";
import { generalTaskRequests, meetings, members, tasks } from "@/db/schema";
import { GENERAL_TASK_ASSUMPTION } from "@/lib/absence-rules";
import { TIMEZONE } from "@/lib/app";
import type { SessionMember } from "@/lib/auth";
import { PICK_ERRORS } from "@/lib/general-tasks";
import { createGeneralTaskAction, pickGeneralTaskAction } from "./general-actions";
import { GeneralTaskForm } from "./general-form";

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE });

/** The "General tasks" tab: standing tasks, never done. Members pick one after missing a meeting. */
export async function GeneralTasks({ me, picked, error }: { me: SessionMember; picked: boolean; error?: string }) {
  const [list, picks, mine, waiting] = await Promise.all([
    db.select().from(tasks).where(and(eq(tasks.kind, "general"), isNull(tasks.deletedAt))).orderBy(asc(tasks.title)),
    db
      .select({ taskId: generalTaskRequests.pickedTaskId, memberId: generalTaskRequests.memberId, name: members.name })
      .from(generalTaskRequests)
      .innerJoin(members, eq(generalTaskRequests.memberId, members.id))
      .where(isNotNull(generalTaskRequests.pickedTaskId)),
    db
      .select({ request: generalTaskRequests, title: meetings.title, startsAt: meetings.startsAt })
      .from(generalTaskRequests)
      .innerJoin(meetings, eq(generalTaskRequests.meetingId, meetings.id))
      .where(eq(generalTaskRequests.memberId, me.id))
      .orderBy(asc(meetings.startsAt)),
    me.isAdmin
      ? db
          .select({ id: generalTaskRequests.id, name: members.name, memberId: members.id, title: meetings.title, startsAt: meetings.startsAt, reason: generalTaskRequests.reason, since: generalTaskRequests.createdAt })
          .from(generalTaskRequests)
          .innerJoin(members, eq(generalTaskRequests.memberId, members.id))
          .innerJoin(meetings, eq(generalTaskRequests.meetingId, meetings.id))
          .where(and(isNull(generalTaskRequests.pickedTaskId), isNull(generalTaskRequests.cancelledAt)))
          .orderBy(asc(generalTaskRequests.createdAt))
      : Promise.resolve([]),
  ]);
  const open = mine.find((r) => !r.request.pickedTaskId && !r.request.cancelledAt);
  const myPicks = mine.filter((r) => r.request.pickedTaskId);
  const titleOf = new Map(list.map((t) => [t.id, t.title]));
  const shownError = PICK_ERRORS.find((e) => e === error);

  return (
    <div className="flex flex-col gap-4" data-testid="general-tasks">
      <p className="rounded-xl bg-surface-3 px-4 py-3 text-sm text-fg-2">
        {GENERAL_TASK_ASSUMPTION} General tasks are never marked as done.
      </p>
      {picked && (
        <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success">
          Thanks! The task is yours.
        </p>
      )}
      {shownError && (
        <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
          {shownError}
        </p>
      )}
      {open && (
        <p className="rounded-xl border border-warning-line bg-warning-bg px-4 py-3 text-sm text-warning" data-testid="pick-banner">
          You missed <strong>{open.title}</strong> on {fmtDate(open.startsAt)}. Pick one of the tasks below.
        </p>
      )}
      {myPicks.length > 0 && (
        <p className="text-sm text-muted">
          You picked:{" "}
          {myPicks.map((r, i) => (
            <span key={r.request.id}>
              {i > 0 && "; "}
              {titleOf.get(r.request.pickedTaskId!) ?? "a removed task"} (for {r.title}, {fmtDate(r.startsAt)})
            </span>
          ))}
        </p>
      )}

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-sm text-subtle">
          No general tasks yet.{me.isAdmin ? " Add the first one below." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {list.map((t) => {
            const helpers = picks.filter((p) => p.taskId === t.id);
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <Link href={`/tasks/${t.id}`} className="flex min-w-0 flex-1 flex-col gap-1 hover:underline">
                  <span className="font-medium">{t.title}</span>
                  {t.description && <span className="text-sm text-muted">{t.description}</span>}
                  <span className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                    {t.type && <TypeBadge type={t.type} />}
                    {/* Who picked a task shows who missed a meeting: names for admins only. */}
                    {helpers.length > 0 && (me.isAdmin ? `Picked by ${helpers.map((h) => h.name).join(", ")}` : `${helpers.length} helping`)}
                  </span>
                </Link>
                {open && (
                  <form action={pickGeneralTaskAction.bind(null, open.request.id, t.id)}>
                    <button type="submit" className={secondaryButtonClass}>
                      Pick this
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {me.isAdmin && (
        <>
          <section className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-card" data-testid="still-to-pick">
            <h2 className="font-semibold">Still to pick a general task ({waiting.length})</h2>
            {waiting.length === 0 ? (
              <p className="text-sm text-muted">Nobody.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {waiting.map((w) => (
                  <li key={w.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="font-medium">{w.name}</span>
                    <span className="text-muted">
                      {w.title}, {fmtDate(w.startsAt)} · {w.reason} · asked {fmtDate(w.since)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <details className="rounded-card border border-line bg-surface p-5 shadow-card">
            <summary className="cursor-pointer font-semibold">Add a general task</summary>
            <div className="mt-3">
              <GeneralTaskForm action={createGeneralTaskAction} submitLabel="Add general task" />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
