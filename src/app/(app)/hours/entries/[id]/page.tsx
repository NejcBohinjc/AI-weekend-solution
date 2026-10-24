import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { members, timeEntries } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { canEditEntry, formatDay, formatDuration, hoursReturnPath, ljubljanaParts, weekBounds, weekStartOf } from "@/lib/hours/time";
import { deleteEntryAction, saveEntryAction } from "../../actions";
import { EntryForm } from "../../entry-form";

export default async function EditEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ id: rawId }, sp] = await Promise.all([params, searchParams]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();

  // The entry is fetched while the session is checked; it is only shown if canEditEntry() allows it.
  const [me, [row]] = await Promise.all([
    requireMember(),
    db
      .select({ entry: timeEntries, name: members.name })
      .from(timeEntries)
      .innerJoin(members, eq(timeEntries.memberId, members.id))
      .where(and(eq(timeEntries.id, id), isNull(timeEntries.deletedAt)))
      .limit(1),
  ]);
  const thisWeek = weekStartOf(new Date());
  if (!row || !row.entry.endedAt || !canEditEntry(me, row.entry, weekBounds(thisWeek).from)) notFound();
  const { entry } = row;
  const returnTo = hoursReturnPath(sp.returnTo);
  const start = ljubljanaParts(entry.startedAt);
  const end = ljubljanaParts(entry.endedAt!);

  return (
    <section className="flex max-w-md flex-col gap-4">
      <Link href={returnTo} className="text-sm text-subtle hover:text-fg">
        ← Hours
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit hours{entry.memberId !== me.id ? ` · ${row.name}` : ""}</h1>
        <p className="text-sm text-muted">
          {formatDay(start.date)}, {start.time}–{end.time} ({formatDuration(entry.endedAt!.getTime() - entry.startedAt.getTime())})
          {entry.source === "seed" && " · imported history, not written to the sheet"}
        </p>
      </div>
      <EntryForm
        action={saveEntryAction.bind(null, entry.id, null)}
        defaults={{ date: start.date, start: start.time, end: end.time, location: entry.location ?? "unspecified" }}
        returnTo={returnTo}
        submitLabel="Save changes"
        minDate={me.isAdmin ? undefined : thisWeek}
        maxDate={ljubljanaParts(new Date()).date}
      />
      <form action={deleteEntryAction.bind(null, entry.id)} className="border-t border-line pt-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        <button type="submit" className="text-sm font-medium text-danger hover:underline">
          Delete this entry
        </button>
      </form>
    </section>
  );
}
