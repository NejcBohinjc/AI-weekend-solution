"use client";

// A meeting's recordings: player (parts back to back), "Download MP3" (parts joined in the browser),
// and for admins transcription, the editable transcript ("Save as meeting notes") and delete.
// Attendees get the player and a read-only transcript.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { useRecorder } from "@/components/recorder/recorder-provider";
import { TIMEZONE } from "@/lib/app";
import { TRANSCRIBE_LANGUAGES } from "@/lib/recordings/constants";
import { joinMp3 } from "@/lib/recordings/client/mp3-join";
import type { Progress } from "@/lib/recordings/transcription";
import {
  deleteRecordingAction,
  finishRecordingAction,
  playbackUrlsAction,
  saveTranscriptAction,
  startTranscriptionAction,
  transcriptionProgressAction,
} from "./recording-actions";

export type RecordingView = {
  id: number;
  startedAt: string;
  durationMs: number;
  status: "recording" | "uploaded" | "transcribing" | "transcribed" | "failed";
  error: string | null;
  source: "recorded" | "uploaded";
  fileName: string | null;
  startedBy: string | null;
  parts: number;
  failedParts: number;
  transcript: string | null;
  savedNote: boolean;
  transcribedSeconds: number;
  transcribeModel: string | null;
  languages: string | null;
};

const STATUS: Record<RecordingView["status"], string> = {
  recording: "Recording",
  uploaded: "Saved",
  transcribing: "Transcribing…",
  transcribed: "Transcribed",
  failed: "Transcription incomplete",
};

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m > 0 ? `${m} min` : `${Math.round(ms / 1000)} s`;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

type Part = { index: number; url: string | null; contentType: string; durationMs: number };

function Player({ recordingId, fileBase }: { recordingId: number; fileBase: string }) {
  const [parts, setParts] = useState<Part[] | null>(null);
  const [i, setI] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function load(): Promise<Part[] | null> {
    const r = await playbackUrlsAction(recordingId);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setParts(r.parts);
    return r.parts;
  }

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      const list = parts ?? (await load());
      if (!list?.length) return;
      if (list.some((p) => !p.url)) throw new Error("a part is missing in storage");
      const files = await Promise.all(
        list.map(async (p) => {
          const res = await fetch(p.url!);
          if (!res.ok) throw new Error(`download failed (${res.status})`);
          return new Uint8Array(await res.arrayBuffer());
        }),
      );
      const mp3 = list.every((p) => p.contentType === "audio/mpeg");
      // MP3 parts are joined into one file; a single imported file of another type is saved as it is.
      const blob = mp3 ? new Blob([joinMp3(files) as BlobPart], { type: "audio/mpeg" }) : new Blob([files[0] as BlobPart], { type: list[0].contentType });
      const ext = mp3 ? "mp3" : ({ "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm" }[list[0].contentType] ?? "audio");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileBase}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (err) {
      setError(`Could not download: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {parts && parts[i]?.url ? (
        <>
          <audio key={i} controls autoPlay src={parts[i].url!} onEnded={() => i + 1 < parts.length && setI(i + 1)} className="w-full" data-testid="player" />
          {parts.length > 1 && (
            <div className="flex items-center gap-2 text-xs text-subtle">
              <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="rounded px-1.5 py-0.5 ring-1 ring-line disabled:opacity-40">
                ←
              </button>
              <span>
                Part {i + 1} of {parts.length} · they play one after another
              </span>
              <button type="button" disabled={i + 1 >= parts.length} onClick={() => setI(i + 1)} className="rounded px-1.5 py-0.5 ring-1 ring-line disabled:opacity-40">
                →
              </button>
            </div>
          )}
        </>
      ) : (
        <button type="button" onClick={() => void load()} className={`${secondaryButtonClass} self-start`}>
          ▶ Play
        </button>
      )}
      <button type="button" onClick={() => void download()} disabled={downloading} className="self-start text-sm font-medium text-fg-2 underline-offset-2 hover:underline disabled:opacity-50">
        {downloading ? "Preparing the download…" : "Download MP3"}
      </button>
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

function Transcription({ rec, meetingId, transcribeReady }: { rec: RecordingView; meetingId: number; transcribeReady: boolean }) {
  const router = useRouter();
  const [languages, setLanguages] = useState(rec.languages ?? "sl");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(rec.transcript ?? "");
  const [saved, setSaved] = useState(rec.savedNote);
  const transcribing = rec.status === "transcribing";

  // Poll while transcribing; the poll also restarts the background run when one ran out of time.
  useEffect(() => {
    if (!transcribing) return;
    let stop = false;
    const tick = async () => {
      const r = await transcriptionProgressAction(rec.id).catch(() => null);
      if (stop || !r) return;
      if (r.ok) {
        setProgress(r.progress);
        if (r.progress.status !== "transcribing") return router.refresh();
      }
      setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [transcribing, rec.id, router]);
  useEffect(() => setText(rec.transcript ?? ""), [rec.transcript]);

  async function start(onlyFailed: boolean) {
    setBusy(true);
    setError(null);
    const r = await startTranscriptionAction(rec.id, meetingId, languages, onlyFailed);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveTranscriptAction(rec.id, text);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  if (!transcribeReady) {
    return <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">Transcription is off: OPENAI_API_KEY is not set. (Only admins see this.)</p>;
  }
  const languagePicker = (
    <select value={languages} onChange={(e) => setLanguages(e.target.value)} className={`${inputClass} w-auto py-1.5 text-sm`} aria-label="Language of the recording">
      {Object.entries(TRANSCRIBE_LANGUAGES).map(([k, v]) => (
        <option key={k} value={k}>
          {v.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="transcription">
      {rec.status === "uploaded" && (
        <div className="flex flex-wrap items-center gap-2">
          {languagePicker}
          <button type="button" disabled={busy} onClick={() => void start(false)} className={secondaryButtonClass}>
            {busy ? "Starting…" : "Transcribe"}
          </button>
        </div>
      )}
      {transcribing && (
        <p role="status" className="text-sm text-fg-2" data-testid="transcribe-progress">
          Transcribing… {progress ? `${progress.done} of ${progress.total} parts done${progress.failed ? `, ${progress.failed} failed` : ""}` : ""}. You can leave this page.
        </p>
      )}
      {rec.status === "failed" && (
        <div className="flex flex-col gap-2">
          <p className={errorClass}>{rec.error}</p>
          <div className="flex flex-wrap items-center gap-2">
            {languagePicker}
            <button type="button" disabled={busy} onClick={() => void start(true)} className={secondaryButtonClass}>
              Retry the {rec.failedParts === 1 ? "failed part" : `${rec.failedParts} failed parts`}
            </button>
          </div>
        </div>
      )}
      {(rec.status === "transcribed" || rec.status === "failed") && rec.transcript !== null && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg-2">Transcript: fix names and mistakes, then save it as the meeting notes</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className={`${inputClass} text-sm`} data-testid="transcript" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => void save()} className={primaryButtonClass}>
              {saved ? "Save again as new notes" : "Save as meeting notes"}
            </button>
            {saved && <span className="text-sm text-success">Saved as meeting notes. Create tasks from them under “Meeting notes”.</span>}
          </div>
        </div>
      )}
      {rec.transcribedSeconds > 0 && (
        <p className="text-xs text-subtle" data-testid="usage">
          Usage: {formatDuration(rec.transcribedSeconds * 1000)} of audio transcribed{rec.transcribeModel ? ` with ${rec.transcribeModel}` : ""} (retries count again). Only admins see this.
        </p>
      )}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}

export function RecordingItem({
  rec,
  meetingId,
  meetingTitle,
  isAdmin,
  transcribeReady,
}: {
  rec: RecordingView;
  meetingId: number;
  meetingTitle: string;
  isAdmin: boolean;
  transcribeReady: boolean;
}) {
  const router = useRouter();
  const recorder = useRecorder();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recordingHere = recorder?.recordingId === rec.id;
  const fileBase = `${meetingTitle} ${rec.startedAt.slice(0, 10)}`.replace(/[^\p{L}\p{N} -]+/gu, "").replace(/\s+/g, "-");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Something went wrong.");
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0" data-testid="recording">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{rec.source === "uploaded" ? `Imported: ${rec.fileName ?? "audio file"}` : `Recording of ${when(rec.startedAt)}`}</span>
        {rec.durationMs > 0 && <span className="text-muted">· {formatDuration(rec.durationMs)}</span>}
        {isAdmin && rec.startedBy && <span className="text-muted">· by {rec.startedBy}</span>}
        <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-2">{STATUS[rec.status]}</span>
      </p>

      {rec.status === "recording" ? (
        <p className="text-sm text-muted">
          {recordingHere ? "Being recorded in this browser." : `Recording in progress or interrupted: ${rec.parts} ${rec.parts === 1 ? "part" : "parts"} uploaded so far.`}
          {isAdmin && !recordingHere && (
            <button type="button" disabled={busy} onClick={() => void run(() => finishRecordingAction(rec.id, meetingId))} className="ml-2 font-medium text-fg-2 underline">
              Finish with the uploaded parts
            </button>
          )}
        </p>
      ) : (
        rec.parts > 0 && <Player recordingId={rec.id} fileBase={fileBase} />
      )}

      {isAdmin && rec.status !== "recording" && <Transcription rec={rec} meetingId={meetingId} transcribeReady={transcribeReady} />}
      {!isAdmin && rec.transcript && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Transcript</summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-sans text-sm text-fg-2">{rec.transcript}</pre>
        </details>
      )}

      {isAdmin && !recordingHere && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Delete this recording and its audio files? Saved meeting notes stay.")) void run(() => deleteRecordingAction(rec.id, meetingId));
          }}
          className="self-start text-xs font-medium text-danger hover:underline"
        >
          Delete recording
        </button>
      )}
      {error && <p className={errorClass}>{error}</p>}
    </div>
  );
}
