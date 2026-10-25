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

const MEDIA_ICONS = [
  { key: "recording", icon: "🎙", label: "Recording available" },
  { key: "transcript", icon: "📝", label: "Transcript available" },
  { key: "summary", icon: "✦", label: "Summary available" },
] as const;

/** Small icons for what a past meeting has: recording, transcript, summary (nothing when it has none). */
export function MediaIcons({ media }: { media?: { recording: boolean; transcript: boolean; summary: boolean } }) {
  const shown = MEDIA_ICONS.filter((m) => media?.[m.key]);
  if (!shown.length) return null;
  return (
    <span className="flex items-center gap-1 text-sm" data-testid="media-icons">
      {shown.map((m) => (
        <span key={m.key} role="img" aria-label={m.label} title={m.label} data-media={m.key}>
          {m.icon}
        </span>
      ))}
    </span>
  );
}

/** One meeting in a list, linking to its page. `media`: what a past meeting has (icons). */
export function MeetingRow({ meeting, state, href, media }: { meeting: Meeting; state?: AttendanceState | null; href: string; media?: { recording: boolean; transcript: boolean; summary: boolean } }) {
  const off = meeting.status !== "confirmed";
  // The series is named in most titles already ("Summer School meeting"): no second label then.
  const showSeries = !meeting.title.toLowerCase().includes(meeting.series.toLowerCase());
  return (
    <li>
      <Link href={href} className={`flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2 sm:px-5 ${off ? "opacity-60" : ""}`}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`font-display font-semibold tracking-display ${off ? "line-through" : ""}`}>{meeting.title}</span>
          <span className="text-sm text-muted">{meetingWhen(meeting)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          <MediaIcons media={media} />
          {showSeries && <SeriesBadge series={meeting.series} />}
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
