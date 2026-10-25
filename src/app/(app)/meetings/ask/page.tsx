import Link from "next/link";
import { notFound } from "next/navigation";
import { QA_NOTES_MAX_CHARS, QA_QUESTION_MAX_CHARS } from "@/lib/ai/meeting-qa";
import { askableMeetings } from "@/lib/ai/meeting-qa-run";
import { aiEnabled } from "@/lib/ai/meeting-tasks";
import { requireMember } from "@/lib/auth";
import { askAction } from "./actions";
import { AskForm } from "./ask-form";

export const dynamic = "force-dynamic";

/** Ask a question about a meeting; answered from its stored notes only. Hidden without ANTHROPIC_API_KEY. */
export default async function AskMeetingPage({ searchParams }: { searchParams: Promise<{ meeting?: string }> }) {
  const [me, sp] = await Promise.all([requireMember(), searchParams]);
  if (!aiEnabled()) notFound();
  const meetings = await askableMeetings(me);
  const wanted = Number(sp.meeting);
  const initial = meetings.some((m) => m.id === wanted) ? wanted : null;

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/meetings" className="text-sm text-subtle hover:text-fg">
          ← Meetings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Ask about a meeting</h1>
        <p className="text-sm text-muted">
          Ask what was discussed or decided at a meeting you were invited to. The answer only uses that meeting&apos;s notes and quotes them.
        </p>
      </div>
      {meetings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm text-subtle">
          None of your meetings have notes yet. Notes are added on the meeting&apos;s page.
        </p>
      ) : (
        <AskForm
          action={askAction}
          meetings={meetings.map((m) => ({ ...m, startsAt: m.startsAt.toISOString() }))}
          initialMeetingId={initial}
          maxQuestion={QA_QUESTION_MAX_CHARS}
          notesCap={QA_NOTES_MAX_CHARS}
        />
      )}
    </section>
  );
}
