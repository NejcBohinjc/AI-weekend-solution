import { MeetingRow } from "@/components/meetings";
import { requireMember } from "@/lib/auth";
import { emailSettings } from "@/lib/email";
import { syncCalendarInBackground } from "@/lib/meetings/auto-sync";
import { myMeetings, reminderSettingsFor } from "@/lib/meetings/queries";
import { attendanceSummary, effectiveState, meetingPhase } from "@/lib/meetings/rules";
import { NowMeetingCard } from "./now-card";
import { ReminderSettingsForm } from "./reminder-settings-form";

export default async function MeetingsPage() {
  const me = await requireMember();
  syncCalendarInBackground();
  const now = new Date();
  const [rows, settings] = await Promise.all([myMeetings(me.id), reminderSettingsFor(me.id)]);
  const list = rows.map((r) => ({ ...r, phase: meetingPhase(r.meeting, now), effective: effectiveState(r.state, r.meeting, now) }));
  const happening = list.filter((r) => r.phase === "open" && r.meeting.status === "confirmed");
  const upcoming = list.filter((r) => r.phase === "upcoming");
  const past = list.filter((r) => r.phase === "past").reverse();
  const summary = attendanceSummary(past.filter((r) => r.meeting.status === "confirmed").map((r) => r.effective));

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Meetings</h1>
        <p className="text-sm text-muted">
          {summary.total ? `You attended ${summary.attended} of ${summary.total} meetings (${summary.rate}%)` : "No past meetings yet"} ·{" "}
          {upcoming.length} upcoming
        </p>
      </div>

      {happening.map((r) => (
        <NowMeetingCard key={r.meeting.id} meeting={r.meeting} state={r.state} note={r.note} source={r.source} now={now} />
      ))}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Upcoming</h2>
        {upcoming.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm" data-testid="upcoming-meetings">
            {upcoming.map((r) => (
              <MeetingRow key={r.meeting.id} meeting={r.meeting} state={r.state ?? undefined} href={`/meetings/${r.meeting.id}`} />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm text-subtle">No upcoming meetings.</p>
        )}
        <p className="text-xs text-subtle">Open a meeting to send an excuse. You can check in from 15 minutes before it starts.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">History</h2>
        {summary.total > 0 && (
          <p className="text-sm text-muted">
            {summary.present} present · {summary.remote} remote · {summary.excused} excused · {summary.unexcused} unexcused
          </p>
        )}
        {past.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm" data-testid="past-meetings">
            {past.map((r) => (
              <MeetingRow key={r.meeting.id} meeting={r.meeting} state={r.effective} href={`/meetings/${r.meeting.id}`} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Reminders</h2>
        <ReminderSettingsForm email={me.email} emailEnabled={settings.emailEnabled} minutesBefore={settings.minutesBefore} sending={emailSettings().sending} />
      </div>
    </section>
  );
}
