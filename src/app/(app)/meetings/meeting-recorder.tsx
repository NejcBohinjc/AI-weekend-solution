"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorClass, secondaryButtonClass } from "@/components/ui";
import { clockFromSeconds, extensionFor, formatBytes } from "@/lib/meetings/recordings";
import { uploadRecording } from "./upload-recording";

type Phase = "idle" | "starting" | "recording" | "paused" | "uploading" | "saved" | "failed" | "kept";

// The first format the browser can record. MP4 first (Chrome, Edge, Safari): recorded WebM has no
// length in the file, so players cannot show the length or seek. Firefox records only WebM/Ogg.
const FORMATS = ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"];

const noSubscribe = () => () => {};
const canRecord = () => "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;

/**
 * Records an in-person meeting with the device's microphone and stores it with the meeting. The
 * recording stays in memory until it is stored; if that fails it can still be downloaded, so it is
 * never lost. The screen is kept awake while recording.
 */
export function MeetingRecorder({ meetingId, fileBase, storageOn }: { meetingId: number; fileBase: string; storageOn: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<{ blob: Blob; url: string; name: string; seconds: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  // Elapsed time without the paused stretches.
  const clock = useRef({ runningSince: 0, before: 0 });

  // The server assumes the browser can record (most can), so server and browser render the same.
  const supported = useSyncExternalStore(noSubscribe, canRecord, () => true);
  const busy = phase === "recording" || phase === "paused" || phase === "uploading";

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSeconds(clock.current.before + (Date.now() - clock.current.runningSince) / 1000), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Leaving the page would lose the recording.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(
    () => () => {
      if (file?.url) URL.revokeObjectURL(file.url);
    },
    [file],
  );

  async function start() {
    setError(null);
    setPhase("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
      const r = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 48_000 });
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void wakeLock.current?.release().catch(() => {});
        wakeLock.current = null;
        const blob = new Blob(chunks.current, { type: r.mimeType || mimeType || "audio/webm" });
        const total = Math.round(clock.current.before);
        const name = `${fileBase}.${extensionFor(blob.type)}`;
        setFile({ blob, url: URL.createObjectURL(blob), name, seconds: total });
        if (storageOn) void save(blob, name, total);
        else setPhase("kept");
      };
      r.start(10_000); // hand over data every 10 s rather than all at the end
      recorder.current = r;
      clock.current = { runningSince: Date.now(), before: 0 };
      setSeconds(0);
      setPhase("recording");
      try {
        wakeLock.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        // Not available (or not allowed): recording still works, the screen may just turn off.
      }
    } catch {
      setPhase("idle");
      setError("The microphone could not be used. Allow microphone access for this site and try again.");
    }
  }

  function pause() {
    recorder.current?.pause();
    clock.current.before += (Date.now() - clock.current.runningSince) / 1000;
    setSeconds(clock.current.before);
    setPhase("paused");
  }

  function resume() {
    recorder.current?.resume();
    clock.current.runningSince = Date.now();
    setPhase("recording");
  }

  function stop() {
    if (phase === "recording") clock.current.before += (Date.now() - clock.current.runningSince) / 1000;
    recorder.current?.stop();
    setPhase("uploading");
    setProgress(0);
  }

  async function save(blob: Blob, name: string, total: number) {
    setPhase("uploading");
    setError(null);
    const result = await uploadRecording({ meetingId, blob, fileName: name, source: "recorded", durationSeconds: total, onProgress: setProgress });
    if (result.error) {
      setError(result.error);
      setPhase("failed");
    } else {
      setPhase("saved");
      router.refresh();
    }
  }

  if (!supported) {
    return <p className="text-sm text-subtle">This browser cannot record audio. Use a recent Chrome, Firefox, Edge or Safari.</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="meeting-recorder">
      {(phase === "idle" || phase === "starting") && (
        <>
          <p className="text-sm text-muted">Record this meeting in the room with your device&apos;s microphone. Tell everyone you are recording before you start.</p>
          <button
            type="button"
            onClick={start}
            disabled={phase === "starting"}
            className="self-start rounded-xl bg-danger-solid px-4 py-3 font-semibold text-on-primary shadow-sm hover:bg-danger-solid-hover disabled:opacity-60"
          >
            {phase === "starting" ? "Starting…" : "● Start recording"}
          </button>
        </>
      )}

      {(phase === "recording" || phase === "paused") && (
        <div className="flex flex-col gap-3 rounded-xl border border-danger-line bg-danger-bg p-4" role="status" aria-live="polite">
          <p className="flex items-center gap-2 font-semibold text-danger">
            <span aria-hidden="true" className={phase === "recording" ? "animate-pulse" : ""}>
              ●
            </span>
            {phase === "recording" ? "Recording" : "Paused"}
            <span className="font-mono tabular-nums">{clockFromSeconds(seconds)}</span>
          </p>
          <p className="text-xs text-fg-2">Keep this page open until you stop. The screen stays on while recording.</p>
          <div className="flex flex-wrap gap-2">
            {phase === "recording" ? (
              <button type="button" onClick={pause} className={secondaryButtonClass}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={resume} className={secondaryButtonClass}>
                Resume
              </button>
            )}
            <button type="button" onClick={stop} className="rounded-xl bg-danger-solid px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm hover:bg-danger-solid-hover">
              ■ Stop and save
            </button>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <div className="flex flex-col gap-1.5" role="status">
          <p className="text-sm text-fg-2">Saving the recording{file ? ` (${formatBytes(file.blob.size)})` : ""}… keep this page open.</p>
          <progress value={progress} max={1} className="h-2 w-full" aria-label="Upload progress" />
        </div>
      )}

      {phase === "saved" && (
        <p role="status" className="text-sm text-success">
          Recording saved with this meeting.
        </p>
      )}

      {(phase === "failed" || phase === "kept") && file && (
        <div className="flex flex-col gap-2 rounded-xl border border-warning-line bg-warning-bg p-4 text-sm text-warning">
          <p>
            {phase === "kept"
              ? "Recording storage is not set up yet, so download the recording now and give it to an admin to upload later."
              : "The recording is not saved yet. Try again, or download it so it is not lost."}
          </p>
          <div className="flex flex-wrap gap-2">
            {phase === "failed" && (
              <button type="button" onClick={() => save(file.blob, file.name, file.seconds)} className={secondaryButtonClass}>
                Try again
              </button>
            )}
            <a href={file.url} download={file.name} className={secondaryButtonClass}>
              Download the recording ({formatBytes(file.blob.size)})
            </a>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
