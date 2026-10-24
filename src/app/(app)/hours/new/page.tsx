import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { members } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { hoursReturnPath, ljubljanaParts, weekStartOf } from "@/lib/hours/time";
import { saveEntryAction } from "../actions";
import { EntryForm } from "../entry-form";

/** Add hours by hand. Admins can add for another member with ?member=<id>. */
export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ member?: string; returnTo?: string }> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  let forMember: { id: number; name: string } | null = null;
  if (me.isAdmin && sp.member && Number(sp.member) !== me.id) {
    [forMember] = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, Number(sp.member))).limit(1);
    if (!forMember) notFound();
  }
  const returnTo = hoursReturnPath(sp.returnTo, forMember ? `/admin/hours/${forMember.id}` : "/hours");
  const now = ljubljanaParts(new Date());
  const anHourAgo = ljubljanaParts(new Date(Date.now() - 3_600_000));

  return (
    <section className="flex max-w-md flex-col gap-4">
      <Link href={returnTo} className="text-sm text-slate-500 hover:text-slate-900">
        ← Hours
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add time{forMember ? ` for ${forMember.name}` : ""}</h1>
        <p className="text-sm text-slate-600">For when you forgot to start the timer.</p>
      </div>
      <EntryForm
        action={saveEntryAction.bind(null, null, forMember?.id ?? null)}
        defaults={{ date: anHourAgo.date, start: anHourAgo.time, end: now.time }}
        returnTo={returnTo}
        submitLabel="Add time"
        minDate={me.isAdmin ? undefined : weekStartOf(new Date())}
        maxDate={now.date}
      />
    </section>
  );
}
