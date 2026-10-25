import Link from "next/link";
import { aiEnabled } from "@/lib/ai/meeting-tasks";
import { quietLinkClass } from "@/components/ui";
import { EmptyState, PageTitle, Section } from "@/components/ui-kit";
import { MeetingRow } from "@/components/meetings";
import { requireMember } from "@/lib/auth";
import { syncCalendarInBackground } from "@/lib/meetings/auto-sync";
import { meetingMedia } from "@/lib/meetings/media";
import { myMeetings } from "@/lib/meetings/queries";
import { attendanceSummary, effectiveState, meetingPhase } from "@/lib/meetings/rules";
import { NowMeetingCard } from "./now-card";

export default async function MeetingsPage() {
  const me = await requireMember();
  syncCalendarInBackground();
  const now = new Date();
  const rows = await myMeetings(me.id);
  const list = rows.map((r) => ({ ...r, phase: meetingPhase(r.meeting, now), effective: effectiveState(r.state, r.meeting, now, { lateNotice: !!r.lateNotice, lateDecision: r.lateDecision }) }));
  const happening = list.filter((r) => r.phase === "open" && r.meeting.status === "confirmed");
  const upcoming = list.filter((r) => r.phase === "upcoming");
  const past = list.filter((r) => r.phase === "past").reverse();
  // Only past rows show the media icons, so only those meetings are asked about (see media.ts).
  const media = await meetingMedia(past.map((r) => r.meeting.id));
  const summary = attendanceSummary(past.filter((r) => r.meeting.status === "confirmed").map((r) => r.effective));

  const SHOWN_UPCOMING = 4;
  const SHOWN_PAST = 5;
  const listClass = "divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card";
  const rowsOf = (items: typeof list, past: boolean) =>
    items.map((r) => <MeetingRow key={r.meeting.id} meeting={r.meeting} state={past ? r.effective : (r.state ?? undefined)} href={`/meetings/${r.meeting.id}`} media={past ? media.get(r.meeting.id) : undefined} />);

  return (
    <section className="flex max-w-2xl flex-col gap-10">
      <PageTitle accent="meetings" sub={summary.total ? `You attended ${summary.attended} of ${summary.total} (${summary.rate}%) · ${upcoming.length} coming up` : `${upcoming.length} coming up`}>
        Your
      </PageTitle>

      {happening.map((r) => (
        <NowMeetingCard key={r.meeting.id} meeting={r.meeting} state={r.state} note={r.note} source={r.source} now={now} />
      ))}

      <Section n={1} title="Upcoming" action={aiEnabled() ? <Link href="/meetings/ask" className={quietLinkClass}>✦ Ask about a meeting</Link> : undefined}>
        {upcoming.length ? (
          <>
            <ul className={listClass} data-testid="upcoming-meetings">
              {rowsOf(upcoming.slice(0, SHOWN_UPCOMING), false)}
            </ul>
            {upcoming.length > SHOWN_UPCOMING && (
              <details>
                <summary className={`${quietLinkClass} cursor-pointer`}>Show all {upcoming.length} upcoming</summary>
                <ul className={`${listClass} mt-3`}>{rowsOf(upcoming.slice(SHOWN_UPCOMING), false)}</ul>
              </details>
            )}
            <p className="text-sm text-subtle">Open a meeting to send an excuse. You can check in from 15 minutes before it starts.</p>
          </>
        ) : (
          <EmptyState title="No upcoming meetings" hint="New meetings appear here when they are added to the calendar." />
        )}
      </Section>

      <Section n={2} title="History">
        {summary.total > 0 && (
          <p className="text-sm text-muted">
            {summary.present} present · {summary.remote} remote · {summary.excused} excused · {summary.unexcused} unexcused
          </p>
        )}
        {past.length > 0 && (
          <>
            <ul className={listClass} data-testid="past-meetings">
              {rowsOf(past.slice(0, SHOWN_PAST), true)}
            </ul>
            {past.length > SHOWN_PAST && (
              <details>
                <summary className={`${quietLinkClass} cursor-pointer`}>Show all {past.length} past meetings</summary>
                <ul className={`${listClass} mt-3`}>{rowsOf(past.slice(SHOWN_PAST), true)}</ul>
              </details>
            )}
          </>
        )}
      </Section>
    </section>
  );
}
