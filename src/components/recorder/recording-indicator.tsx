"use client";

// In the header on every page while a recording runs (and while parts still upload, or a recording
// was interrupted), so the admin never forgets it.
import Link from "next/link";
import { useRecorder } from "./recorder-provider";

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}

export function RecordingIndicator() {
  const r = useRecorder();
  if (!r) return null;
  const href = (meetingId: number) => `/meetings/${meetingId}#recording`;
  if ((r.phase === "recording" || r.phase === "paused" || r.phase === "stopping") && r.meeting) {
    const live = r.phase === "recording";
    return (
      <Link
        href={href(r.meeting.id)}
        data-testid="recording-indicator"
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ring-inset ${live ? "bg-danger-bg text-danger ring-danger-line" : "bg-surface-3 text-fg-2 ring-line"}`}
        title={`Recording “${r.meeting.title}”`}
      >
        <span aria-hidden className={`size-2 rounded-full ${live ? "animate-pulse bg-danger" : "bg-subtle"}`} />
        <span className="hidden sm:inline">{r.phase === "stopping" ? "Saving" : live ? "Recording" : "Paused"}</span>
        <span>{formatElapsed(r.elapsedMs)}</span>
      </Link>
    );
  }
  if (r.phase === "importing" || r.queued > 0) {
    return (
      <span data-testid="recording-indicator" className="shrink-0 rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-fg-2 ring-1 ring-inset ring-line">
        {r.phase === "importing" ? "Importing…" : `Uploading ${r.queued} ${r.queued === 1 ? "part" : "parts"}`}
      </span>
    );
  }
  if (r.interrupted.length > 0) {
    return (
      <Link
        href={href(r.interrupted[0].meetingId)}
        data-testid="recording-indicator"
        className="shrink-0 rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning ring-1 ring-inset ring-warning-line"
      >
        Unfinished recording
      </Link>
    );
  }
  return null;
}
