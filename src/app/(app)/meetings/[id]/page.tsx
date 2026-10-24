import Link from "next/link";
import { notFound } from "next/navigation";
import { TierBadge } from "@/components/badges";
import { AttendanceBadge, meetingWhen, SeriesBadge } from "@/components/meetings";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { ATTENDANCE_STATES, STATE_LABELS } from "@/lib/meetings/constants";
import { meetingAttendees, meetingById } from "@/lib/meetings/queries";
import { attendanceSummary, effectiveState, meetingPhase, memberActions } from "@/lib/meetings/rules";
import { adminMarkRestPresentAction, adminSetAttendanceAction, setMyAttendanceAction } from "../actions";
import { AttendanceActions } from "../attendance-actions";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const [me, { id: rawId }] = await Promise.all([requireMember(), params]);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const [meeting, attendees] = await Promise.all([meetingById(id), meetingAttendees(id)]);
  if (!meeting) notFound();
  const mine = attendees.find((a) => a.memberId === me.id);
  if (!mine && !me.isAdmin) notFound();

  const now = new Date();
  const phase = meetingPhase(meeting, now);
  const cancelled = meeting.status !== "confirmed";
  const people = attendees.map((a) => ({ ...a, effective: effectiveState(a.state, meeting, now) }));
  const summary = attendanceSummary(people.map((p) => p.effective));
  const unanswered = people.filter((p) => !p.state).length;
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={me.isAdmin && !mine ? "/admin/meetings" : "/meetings"} className="text-sm text-slate-500 hover:text-slate-900">
          ← Meetings
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{meeting.title}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <SeriesBadge series={meeting.series} />
          <span>{meetingWhen(meeting)}</span>
          {meeting.location && <span>· {meeting.location}</span>}
        </p>
        {cancelled && (
          <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-700">
            {meeting.status === "cancelled" ? "This meeting was cancelled in the calendar." : "This meeting is no longer in the calendar."}
          </p>
        )}
      </div>

      {mine && (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="my-attendance">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Your attendance</h2>
            {!cancelled && <AttendanceBadge state={effectiveState(mine.state, meeting, now)} />}
          </div>
          <AttendanceActions
            action={setMyAttendanceAction.bind(null, meeting.id)}
            current={mine.state}
            note={mine.note}
            can={memberActions({ ...meeting, cancelled }, now)}
            lockedByAdmin={mine.source === "admin"}
          />
          {!cancelled && phase === "upcoming" && (
            <p className="text-xs text-slate-500">Check-in opens 15 minutes before the start. If you don&apos;t check in or send an excuse, you count as unexcused.</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-semibold">Invited ({people.length})</h2>
          {me.isAdmin && (
            <p className="text-sm text-slate-600">
              {summary.present} present · {summary.remote} remote · {summary.excused} excused · {summary.unexcused} unexcused
              {phase !== "past" && unanswered ? ` · ${unanswered} no answer yet` : ""}
            </p>
          )}
        </div>

        {me.isAdmin && phase !== "upcoming" && unanswered > 0 && !cancelled && (
          <form action={adminMarkRestPresentAction.bind(null, meeting.id)}>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-700">
              Mark the other {unanswered} present
            </button>
          </form>
        )}

        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="attendees">
          {people.map((p) => (
            <li key={p.memberId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.name}</span>
                  {me.isAdmin && <TierBadge tier={p.tier} />}
                </span>
                {me.isAdmin && p.state && (
                  <span className="text-xs text-slate-500">
                    {p.note && `“${p.note}” · `}
                    {p.source === "seed" ? "imported" : `${p.source === "admin" ? `set by ${p.setByName ?? "an admin"}` : "by themself"}, ${fmt(p.updatedAt!)}`}
                  </span>
                )}
              </span>
              {me.isAdmin ? (
                <form action={adminSetAttendanceAction.bind(null, meeting.id, p.memberId)} className="flex flex-wrap items-center gap-1" aria-label={`Attendance of ${p.name}`}>
                  {ATTENDANCE_STATES.map((s) => (
                    <button
                      key={s}
                      type="submit"
                      name="state"
                      value={s}
                      aria-pressed={p.effective === s}
                      className={`rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset ${p.effective === s ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
                    >
                      {STATE_LABELS[s]}
                    </button>
                  ))}
                  {p.state && (
                    <button type="submit" name="state" value="clear" className="px-1.5 text-xs text-slate-500 hover:underline" title="Remove the record">
                      Clear
                    </button>
                  )}
                </form>
              ) : p.memberId === me.id ? (
                <span className="text-xs text-slate-500">you</span>
              ) : null}
            </li>
          ))}
        </ul>
        {me.isAdmin && <p className="text-xs text-slate-500">A darker button shows the current state; unanswered invitees count as unexcused once the meeting is over.</p>}
      </div>
    </section>
  );
}
