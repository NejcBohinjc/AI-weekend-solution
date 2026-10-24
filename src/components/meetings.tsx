// Building blocks shared by the member and admin meeting pages and the dashboard.
import Link from "next/link";
import { LinkifiedText } from "./linkified-text";
import type { Meeting } from "@/db/schema";
import { formatDay, ljubljanaParts } from "@/lib/hours/time";
import { STATE_LABELS, type AttendanceState } from "@/lib/meetings/constants";

const STATE_STYLES: Record<AttendanceState, string> = {
  present: "bg-success-bg text-success ring-success-line",
  remote: "bg-info-bg text-info ring-info-line",
  excused: "bg-warning-bg text-warning ring-warning-line",
  unexcused: "bg-danger-bg text-danger ring-danger-line",
};

export function AttendanceBadge({ state }: { state: AttendanceState | null }) {
  if (!state) return <span className="inline-flex rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-line">No answer yet</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_STYLES[state]}`}>{STATE_LABELS[state]}</span>;
}

export function SeriesBadge({ series }: { series: string }) {
  return <span className="inline-flex rounded-md bg-violet-bg px-1.5 py-0.5 text-xs font-medium text-violet">{series}</span>;
}

/** "Mon 26 Oct, 18:00–19:30" in Ljubljana time. */
export function meetingWhen(m: Pick<Meeting, "startsAt" | "endsAt">): string {
  const s = ljubljanaParts(m.startsAt);
  const e = ljubljanaParts(m.endsAt);
  return `${formatDay(s.date)}, ${s.time}–${e.time}${e.date !== s.date ? " (next day)" : ""}`;
}

/** One meeting in a list, linking to its page. */
export function MeetingRow({ meeting, state, href }: { meeting: Meeting; state?: AttendanceState | null; href: string }) {
  const off = meeting.status !== "confirmed";
  return (
    <li>
      <Link href={href} className={`flex flex-col gap-1 px-4 py-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-3 ${off ? "opacity-60" : ""}`}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`font-medium ${off ? "line-through" : ""}`}>{meeting.title}</span>
          <span className="text-sm text-muted">
            {meetingWhen(meeting)}
            {meeting.location && ` · ${meeting.location}`}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <SeriesBadge series={meeting.series} />
          {off ? <span className="text-xs font-medium text-subtle">Cancelled</span> : state !== undefined && <AttendanceBadge state={state} />}
        </span>
      </Link>
      {meeting.description && (
        // Outside the link: a disclosure inside an <a> is not allowed and would navigate on tap.
        <details className="px-4 pb-3 text-sm">
          <summary className="cursor-pointer truncate text-subtle">{meeting.description.split("\n")[0]}</summary>
          <LinkifiedText text={meeting.description} className="mt-1 text-fg-2" />
        </details>
      )}
    </li>
  );
}
