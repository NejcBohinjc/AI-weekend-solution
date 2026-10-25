import Link from "next/link";
import { AttendanceBadge, meetingWhen, SeriesBadge } from "@/components/meetings";
import type { Meeting } from "@/db/schema";
import type { AttendanceState } from "@/lib/meetings/constants";
import { memberActions } from "@/lib/meetings/rules";
import { setMyAttendanceAction } from "./actions";
import { AttendanceActions } from "./attendance-actions";

type Props = { meeting: Meeting; state: AttendanceState | null; note: string | null; source: string | null; now: Date };

/** A meeting the member can check in to right now, with the check-in buttons. Used on /meetings and the dashboard. */
export function NowMeetingCard({ meeting, state, note, source, now }: Props) {
  const can = memberActions({ ...meeting, cancelled: meeting.status !== "confirmed" }, now);
  return (
    <section aria-label="Meeting now" className="flex flex-col gap-3 rounded-card border border-success-line bg-surface p-5 shadow-card" data-testid="meeting-now">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-xs font-semibold uppercase tracking-eyebrow text-success">Happening now</p>
          <Link href={`/meetings/${meeting.id}`} className="font-display text-xl font-semibold tracking-display hover:underline">
            {meeting.title}
          </Link>
          <p className="text-sm text-muted">
            {meetingWhen(meeting)}
            {meeting.location && ` · ${meeting.location}`}
          </p>
        </div>
        <span className="flex items-center gap-1.5">
          <SeriesBadge series={meeting.series} />
          {state && <AttendanceBadge state={state} />}
        </span>
      </div>
      <AttendanceActions
        action={setMyAttendanceAction.bind(null, meeting.id)}
        current={state}
        note={note}
        can={can}
        lockedByAdmin={source === "admin"}
      />
    </section>
  );
}
