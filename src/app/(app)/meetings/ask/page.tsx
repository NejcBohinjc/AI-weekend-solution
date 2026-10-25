import Link from "next/link";
import { quietLinkClass } from "@/components/ui";
import { EmptyState, PageTitle } from "@/components/ui-kit";
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
        <Link href="/meetings" className={quietLinkClass}>
          ← Meetings
        </Link>
        <PageTitle accent="meeting" sub="Ask what was discussed or decided at a meeting you were invited to. The answer only uses that meeting's notes and quotes them.">
          Ask about a
        </PageTitle>
      </div>
      {meetings.length === 0 ? (
        <EmptyState title="No notes to ask about yet" hint="Notes are added on a meeting's page. Then you can ask questions here." />
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
