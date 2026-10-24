// Building blocks shared by the member and admin meeting pages and the dashboard.
import Link from "next/link";
import type { Meeting } from "@/db/schema";
import { formatDay, ljubljanaParts } from "@/lib/hours/time";
import { STATE_LABELS, type AttendanceState } from "@/lib/meetings/constants";

const STATE_STYLES: Record<AttendanceState, string> = {
  present: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  remote: "bg-sky-50 text-sky-700 ring-sky-200",
  excused: "bg-amber-50 text-amber-800 ring-amber-200",
  unexcused: "bg-red-50 text-red-700 ring-red-200",
};

export function AttendanceBadge({ state }: { state: AttendanceState | null }) {
  if (!state) return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">No answer yet</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATE_STYLES[state]}`}>{STATE_LABELS[state]}</span>;
}

export function SeriesBadge({ series }: { series: string }) {
  return <span className="inline-flex rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">{series}</span>;
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
      <Link href={href} className={`flex flex-col gap-1 px-4 py-3 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3 ${off ? "opacity-60" : ""}`}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`font-medium ${off ? "line-through" : ""}`}>{meeting.title}</span>
          <span className="text-sm text-slate-600">
            {meetingWhen(meeting)}
            {meeting.location && ` · ${meeting.location}`}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <SeriesBadge series={meeting.series} />
          {off ? <span className="text-xs font-medium text-slate-500">Cancelled</span> : state !== undefined && <AttendanceBadge state={state} />}
        </span>
      </Link>
    </li>
  );
}
