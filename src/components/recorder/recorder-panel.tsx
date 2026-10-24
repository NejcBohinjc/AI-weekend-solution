"use client";

// "Record meeting" for admins, on the meeting page (that meeting) and the dashboard (the meeting
// happening now, or pick one). Also imports an existing audio file.
import Link from "next/link";
import { useState } from "react";
import { errorClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { IMPORT_EXTENSIONS, SEGMENT_SECONDS } from "@/lib/recordings/constants";
import { useRecorder } from "./recorder-provider";
import { formatElapsed } from "./recording-indicator";

export type RecordableMeeting = { id: number; title: string; label: string };

export function RecorderPanel({ meetings, initialId, storageReady }: { meetings: RecordableMeeting[]; initialId: number | null; storageReady: boolean }) {
  const r = useRecorder();
  const [meetingId, setMeetingId] = useState(initialId ? String(initialId) : "");
  const [consent, setConsent] = useState(false);
  if (!r) return null;
  const picked = meetings.length === 1 ? meetings[0] : (meetings.find((m) => String(m.id) === meetingId) ?? null);
  const active = r.phase === "recording" || r.phase === "paused" || r.phase === "stopping";
  const here = active && r.meeting && meetings.some((m) => m.id === r.meeting!.id);
  const busy = r.phase !== "idle";

  return (
    <div className="flex flex-col gap-3" data-testid="recorder-panel">
      {!storageReady && (
        <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">
          Recording is off: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set. (Only admins see this.)
        </p>
      )}
      {r.supported && !r.supported.ok && <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">{r.supported.reason}</p>}

      {r.interrupted.map((i) => (
        <div key={i.recordingId} role="status" className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning" data-testid="interrupted">
          <span className="flex-1">
            A recording of “{i.meetingTitle}” was interrupted. {i.parts > 0 ? `${i.parts} ${i.parts === 1 ? "part is" : "parts are"} saved on this device and not uploaded yet.` : "All its parts were uploaded."}
          </span>
          <button type="button" onClick={() => void r.finishInterrupted(i.recordingId)} className={secondaryButtonClass}>
            Finish uploading
          </button>
        </div>
      ))}

      {here ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger-line bg-surface p-4" data-testid="recorder-controls">
          <p className={`flex items-center gap-2 text-sm font-semibold ${r.phase === "recording" ? "text-danger" : "text-fg-2"}`}>
            <span aria-hidden className={`size-2.5 rounded-full ${r.phase === "recording" ? "animate-pulse bg-danger" : "bg-subtle"}`} />
            {r.phase === "recording" ? "Recording" : r.phase === "paused" ? "Paused" : "Saving the last part…"} · {r.meeting!.title}
          </p>
          <p className="font-mono text-4xl font-semibold tabular-nums" data-testid="elapsed">
            {formatElapsed(r.elapsedMs)}
          </p>
          <div className="h-2.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-3" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.level * 100)}>
            <div className="h-full rounded-full bg-success-solid transition-[width] duration-100" style={{ width: `${Math.round(r.level * 100)}%` }} data-testid="level" />
          </div>
          <div className="flex w-full max-w-xs gap-2">
            {r.phase === "paused" ? (
              <button type="button" onClick={r.resume} className="flex-1 rounded-xl bg-primary px-4 py-3 text-base font-semibold text-on-primary hover:bg-primary-hover">
                Resume
              </button>
            ) : (
              <button type="button" onClick={r.pause} disabled={r.phase !== "recording"} className="flex-1 rounded-xl bg-surface px-4 py-3 text-base font-semibold text-fg ring-1 ring-inset ring-line-strong hover:bg-surface-2 disabled:opacity-50">
                Pause
              </button>
            )}
            <button type="button" onClick={() => r.stop()} disabled={r.phase === "stopping"} className="flex-1 rounded-xl bg-danger-solid px-4 py-3 text-base font-semibold text-on-primary hover:bg-danger-solid-hover disabled:opacity-50">
              Stop
            </button>
          </div>
          <p className="text-center text-xs text-subtle">
            Saved in {SEGMENT_SECONDS / 60}-minute parts, each uploaded as soon as it is done{r.queued > 0 || r.uploadedParts > 0 ? ` (${r.uploadedParts} uploaded${r.queued ? `, ${r.queued} waiting` : ""})` : ""}.
            {" "}
            {r.wakeLock ? "The screen is kept on while recording." : "Keep the screen on yourself."} On a phone, keep this page open and the screen on: a locked phone stops recording.
          </p>
        </div>
      ) : active && r.meeting ? (
        <p className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
          Recording “{r.meeting.title}” is running.{" "}
          <Link href={`/meetings/${r.meeting.id}#recording`} className="font-semibold underline">
            Open it
          </Link>
        </p>
      ) : meetings.length === 0 ? (
        <p className="text-sm text-muted">No meetings from the last two days or tomorrow. Open a meeting to record it.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {meetings.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Meeting</span>
              <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={inputClass} data-testid="record-meeting">
                <option value="">Pick a meeting</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4" data-testid="consent" />
            <span>
              <strong>I have told everyone in the meeting that it is being recorded.</strong>{" "}
              <span className="text-muted">Everyone must know before recording starts. Recordings are private: only admins and this meeting&apos;s attendees can listen.</span>
            </span>
          </label>
          <button
            type="button"
            disabled={!picked || !consent || busy || !storageReady || r.supported?.ok === false}
            onClick={() => picked && void r.start({ id: picked.id, title: picked.title })}
            className="flex items-center justify-center gap-2 rounded-xl bg-danger-solid px-5 py-3.5 text-base font-semibold text-on-primary shadow-sm hover:bg-danger-solid-hover disabled:opacity-50"
          >
            <span aria-hidden className="size-3 rounded-full bg-on-primary" />
            {r.phase === "starting" ? "Starting…" : "Record meeting"}
          </button>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>…or import an audio file ({IMPORT_EXTENSIONS.join(", ")})</span>
            <input
              type="file"
              accept={`${IMPORT_EXTENSIONS.map((e) => `.${e}`).join(",")},audio/*`}
              disabled={!picked || busy || !storageReady}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && picked) void r.importFile({ id: picked.id, title: picked.title }, f);
              }}
              className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg disabled:opacity-50"
              data-testid="import-file"
            />
          </label>
        </div>
      )}

      {r.error && (
        <p role="alert" className={errorClass} data-testid="recorder-error">
          {r.error}
        </p>
      )}
      {r.uploadError && <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">{r.uploadError}</p>}
      {r.notice && (
        <p role="status" className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-fg-2" data-testid="recorder-notice">
          {r.notice}
          {!busy && r.queued > 0 && ` ${r.queued} ${r.queued === 1 ? "part" : "parts"} still to upload: keep this page open.`}
        </p>
      )}
      {!r.persistent && <p className="text-xs text-subtle">This browser does not keep data for this site (private window?): if it crashes, the current recording cannot be recovered.</p>}
    </div>
  );
}
