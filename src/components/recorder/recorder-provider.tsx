"use client";

// The meeting recorder (admins only). It lives in the app layout, so a recording keeps running while
// the admin moves between pages. Microphone -> AudioWorklet (mono PCM) -> Web Worker (16 kHz, 32 kbps
// MP3, a segment every 10 minutes) -> IndexedDB -> upload straight to Storage with a signed URL ->
// confirm on the server. Each finished segment is uploaded at once, so a crash loses at most the
// current one; unsent segments survive in IndexedDB and the next visit offers to finish uploading.
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { confirmSegmentAction, finishRecordingAction, segmentUploadUrlAction, startRecordingAction } from "@/app/(app)/meetings/recording-actions";
import { DIRECT_IMPORT_TYPES, IMPORT_EXTENSIONS, MAX_DIRECT_IMPORT_BYTES, MAX_IMPORT_BYTES, MAX_RECORDING_SECONDS, MP3_SAMPLE_RATE, SEGMENT_SECONDS } from "@/lib/recordings/constants";
import { deleteSegment, deleteSession, listSegments, listSessions, persistent as idbPersistent, putSegment, putSession, type StoredSegment } from "@/lib/recordings/client/idb";

export type MeetingRef = { id: number; title: string };
export type Phase = "idle" | "starting" | "recording" | "paused" | "stopping" | "importing";
export type Interrupted = { recordingId: number; meetingId: number; meetingTitle: string; parts: number };

export type Recorder = {
  supported: { ok: boolean; reason?: string } | null;
  phase: Phase;
  meeting: MeetingRef | null;
  /** The recording being made in this browser right now. */
  recordingId: number | null;
  elapsedMs: number;
  level: number;
  queued: number;
  uploading: boolean;
  uploadedParts: number;
  uploadError: string | null;
  error: string | null;
  notice: string | null;
  interrupted: Interrupted[];
  persistent: boolean;
  wakeLock: boolean;
  start(meeting: MeetingRef): Promise<void>;
  pause(): void;
  resume(): void;
  stop(reason?: string): void;
  finishInterrupted(recordingId: number): Promise<void>;
  importFile(meeting: MeetingRef, file: File): Promise<void>;
  dismiss(): void;
};

const RecorderContext = createContext<Recorder | null>(null);

/** Null for members (no provider): they never see recording controls. */
export function useRecorder(): Recorder | null {
  return useContext(RecorderContext);
}

function checkSupport(): { ok: boolean; reason?: string } {
  if (!window.isSecureContext) return { ok: false, reason: "Recording needs a secure (https) connection." };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "This browser cannot record audio." };
  if (typeof AudioWorkletNode === "undefined" || typeof Worker === "undefined")
    return { ok: false, reason: "This browser is too old to record here. Use a current Chrome, Edge, Firefox or Safari (iOS 14.5 or newer)." };
  return { ok: true };
}

function micError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow the microphone for this site (the icon next to the address bar, or the phone's settings for this browser), then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is in use by another app or could not be started.";
  return `Could not start the microphone: ${(err as Error)?.message ?? "unknown error"}`;
}

// Server answers that retrying cannot fix: drop the part instead of retrying forever.
const PERMANENT = /not found|already finished|Only admins|Unsupported|Invalid part|unexpected size|not set up/i;
class UploadError extends Error {
  constructor(
    message: string,
    public permanent: boolean,
  ) {
    super(message);
  }
}

async function uploadSegment(seg: StoredSegment): Promise<void> {
  const link = await segmentUploadUrlAction(seg.recordingId, seg.index, seg.ext);
  if (!link.ok) throw new UploadError(link.error, PERMANENT.test(link.error));
  const res = await fetch(link.url, {
    method: "PUT",
    body: seg.blob,
    headers: { "content-type": DIRECT_IMPORT_TYPES[seg.ext] ?? "audio/mpeg", "x-upsert": "true", "cache-control": "3600" },
  });
  if (!res.ok) throw new UploadError(`Upload failed (${res.status}).`, false);
  const ok = await confirmSegmentAction(seg.recordingId, seg.index, seg.ext, seg.durationMs);
  if (!ok.ok) throw new UploadError(ok.error, PERMANENT.test(ok.error));
}

function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const timer = setTimeout(() => done(0), 15_000);
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
    };
    a.onerror = () => {
      clearTimeout(timer);
      done(0);
    };
    a.src = url;
  });
}

/** 10 minutes; the browser test shortens it (window.__RECORDER_SEGMENT_SECONDS__) to see several parts quickly. */
const segmentSeconds = (): number => (window as unknown as { __RECORDER_SEGMENT_SECONDS__?: number }).__RECORDER_SEGMENT_SECONDS__ ?? SEGMENT_SECONDS;

const newWorker = () => new Worker(new URL("../../lib/recordings/client/mp3-worker.ts", import.meta.url), { type: "module" });

type Audio = {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
  analyser: AnalyserNode;
  worker: Worker;
};

export function RecorderProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [supported, setSupported] = useState<Recorder["supported"]>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [meeting, setMeeting] = useState<MeetingRef | null>(null);
  const [elapsedMs, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [queued, setQueued] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadedParts, setUploadedParts] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<Interrupted[]>([]);
  const [persistent, setPersistent] = useState(true);

  const audio = useRef<Audio | null>(null);
  const activeId = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const clock = useRef({ accumulated: 0, since: 0 as number | null });
  const writes = useRef<Promise<void>>(Promise.resolve());
  const wake = useRef<WakeLockSentinel | null>(null);
  const pumping = useRef(false);
  const retry = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempt: number }>({ timer: null, attempt: 0 });
  const stopReason = useRef<string | null>(null);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const elapsedNow = () => clock.current.accumulated + (clock.current.since ? performance.now() - clock.current.since : 0);

  const refreshInterrupted = useCallback(async () => {
    const [sessions, segs] = await Promise.all([listSessions(), listSegments()]);
    setInterrupted(
      sessions
        .filter((s) => s.state === "recording" && s.recordingId !== activeId.current)
        .map((s) => ({ recordingId: s.recordingId, meetingId: s.meetingId, meetingTitle: s.meetingTitle, parts: segs.filter((g) => g.recordingId === s.recordingId).length })),
    );
  }, []);

  /** Uploads waiting parts one at a time; finishes recordings whose parts are all up. Retries with backoff. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    if (retry.current.timer) clearTimeout(retry.current.timer);
    retry.current.timer = null;
    try {
      for (;;) {
        const sessions = await listSessions();
        const eligible = new Set(sessions.filter((s) => s.state === "finishing" || s.recordingId === activeId.current).map((s) => s.recordingId));
        const segs = (await listSegments()).filter((s) => eligible.has(s.recordingId));
        setQueued(segs.length);
        if (!segs.length) {
          for (const s of sessions.filter((x) => x.state === "finishing")) {
            const r = await finishRecordingAction(s.recordingId, s.meetingId);
            if (!r.ok && !PERMANENT.test(r.error)) throw new UploadError(r.error, false);
            await deleteSession(s.recordingId);
            setNotice(r.ok && r.removed ? `Nothing was recorded for “${s.meetingTitle}”.` : `The recording of “${s.meetingTitle}” is saved.`);
            router.refresh();
          }
          break;
        }
        const seg = segs[0];
        setUploading(true);
        try {
          await uploadSegment(seg);
        } catch (err) {
          if (err instanceof UploadError && err.permanent) {
            await deleteSegment(seg.recordingId, seg.index);
            if (/not found/i.test(err.message)) await deleteSession(seg.recordingId);
            setUploadError(`A part could not be saved: ${err.message}`);
            continue;
          }
          throw err;
        }
        await deleteSegment(seg.recordingId, seg.index);
        setUploadedParts((n) => n + 1);
        setUploadError(null);
        retry.current.attempt = 0;
      }
    } catch (err) {
      const attempt = ++retry.current.attempt;
      const wait = [2, 5, 15, 30, 60][Math.min(attempt - 1, 4)] * 1000;
      setUploadError(`Upload is waiting to retry (${(err as Error).message || "no connection"}). Keep this page open.`);
      retry.current.timer = setTimeout(() => void pump(), wait);
    } finally {
      pumping.current = false;
      setUploading(false);
      void refreshInterrupted();
    }
  }, [refreshInterrupted, router]);

  // On load: is recording possible here, and is anything left over from an earlier visit?
  useEffect(() => {
    setSupported(checkSupport());
    void idbPersistent().then(setPersistent);
    void (async () => {
      await refreshInterrupted();
      // Parts of a recording that was stopped but not fully uploaded: carry on without asking.
      if ((await listSessions()).some((s) => s.state === "finishing")) void pump();
    })();
    const online = () => void pump();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [pump, refreshInterrupted]);

  // Warn before closing the tab while recording or while parts are still to be uploaded.
  useEffect(() => {
    const busy = phase === "recording" || phase === "paused" || phase === "stopping" || phase === "importing" || queued > 0;
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase, queued]);

  const lockScreen = useCallback(async () => {
    try {
      wake.current = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      wake.current = null;
    }
  }, []);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && (phaseRef.current === "recording" || phaseRef.current === "paused")) void lockScreen();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [lockScreen]);

  // Elapsed time, the 3-hour limit and the level meter.
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const buf = new Float32Array(1024);
    const id = setInterval(() => {
      const ms = elapsedNow();
      setElapsed(ms);
      if (ms >= MAX_RECORDING_SECONDS * 1000) stopRef.current?.(`Stopped at the ${MAX_RECORDING_SECONDS / 3600}-hour maximum. Start a new recording to continue.`);
      const a = audio.current;
      if (a && phaseRef.current === "recording") {
        a.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      } else setLevel(0);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  const teardown = useCallback(() => {
    const a = audio.current;
    audio.current = null;
    if (a) {
      a.stream.getTracks().forEach((t) => t.stop());
      a.node.port.onmessage = null;
      void a.ctx.close().catch(() => {});
      a.worker.terminate();
    }
    void wake.current?.release().catch(() => {});
    wake.current = null;
    clock.current = { accumulated: 0, since: null };
    setLevel(0);
  }, []);

  /** Wires a worker so every segment it finishes is stored, in order, and queued for upload. */
  const wireWorker = useCallback(
    (worker: Worker, recordingId: number, onDone: () => void) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "segment") {
          writes.current = writes.current.then(() => putSegment({ recordingId, index: msg.index, ext: "mp3", blob: msg.blob, durationMs: msg.durationMs })).then(() => void pump());
        } else if (msg.type === "done") {
          writes.current = writes.current.then(onDone);
        }
      };
    },
    [pump],
  );

  const finishStop = useCallback(async () => {
    const id = activeId.current;
    const m = meetingRef.current;
    teardown();
    if (id && m) await putSession({ recordingId: id, meetingId: m.id, meetingTitle: m.title, startedAt: Date.now(), state: "finishing" });
    activeId.current = null;
    setPhaseBoth("idle");
    setMeeting(null);
    setNotice(stopReason.current ?? "Recording stopped. Uploading the last part…");
    stopReason.current = null;
    void pump();
  }, [pump, teardown]);

  const meetingRef = useRef<MeetingRef | null>(null);
  const stopRef = useRef<((reason?: string) => void) | null>(null);

  const stop = useCallback((reason?: string) => {
    const a = audio.current;
    if (!a || (phaseRef.current !== "recording" && phaseRef.current !== "paused")) return;
    if (reason) stopReason.current = reason;
    clock.current = { accumulated: elapsedNow(), since: null };
    setPhaseBoth("stopping");
    // The worklet posts what it still holds, then "flushed"; the worker then ends the last segment.
    a.node.port.postMessage({ type: "flush" });
  }, []);
  stopRef.current = stop;

  const start = useCallback(
    async (m: MeetingRef) => {
      if (phaseRef.current !== "idle") return;
      const support = checkSupport();
      if (!support.ok) {
        setError(support.reason ?? "Recording is not supported here.");
        return;
      }
      setError(null);
      setNotice(null);
      setUploadError(null);
      setPhaseBoth("starting");
      // Created inside the click, so iOS Safari lets it run.
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      } catch (err) {
        void ctx.close().catch(() => {});
        setPhaseBoth("idle");
        setError(micError(err));
        return;
      }
      let recordingId: number | null = null;
      try {
        const r = await startRecordingAction(m.id, "recorded", null);
        if (!r.ok) throw new Error(r.error);
        recordingId = r.recordingId;
        await ctx.audioWorklet.addModule("/recorder-worklet.js");
        await ctx.resume();
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "recorder-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const silent = ctx.createGain();
        silent.gain.value = 0; // the worklet must be pulled by the graph; nothing is played back
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(node);
        node.connect(silent);
        silent.connect(ctx.destination);
        source.connect(analyser);
        const worker = newWorker();
        worker.onerror = (e) => {
          setError(`The MP3 encoder stopped: ${e.message || "unknown error"}`);
          stopRef.current?.();
        };
        worker.postMessage({ type: "init", inputRate: ctx.sampleRate, segmentSeconds: segmentSeconds(), firstIndex: 0 });
        node.port.onmessage = (e: MessageEvent) => {
          if (e.data.type === "pcm") worker.postMessage({ type: "pcm", data: e.data.data }, [e.data.data.buffer]);
          else if (e.data.type === "flushed") worker.postMessage({ type: "flush" });
        };
        activeId.current = recordingId;
        wireWorker(worker, recordingId, finishStop);
        audio.current = { ctx, stream, node, analyser, worker };
        await putSession({ recordingId, meetingId: m.id, meetingTitle: m.title, startedAt: Date.now(), state: "recording" });
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
          setError("The microphone was disconnected. What was recorded until then is kept.");
          stopRef.current?.();
        });
        meetingRef.current = m;
        setMeeting(m);
        setUploadedParts(0);
        clock.current = { accumulated: 0, since: performance.now() };
        setElapsed(0);
        setPhaseBoth("recording");
        void lockScreen();
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
        audio.current = null;
        activeId.current = null;
        if (recordingId) {
          await deleteSession(recordingId).catch(() => {});
          await finishRecordingAction(recordingId, m.id).catch(() => {}); // removes the empty recording
        }
        setPhaseBoth("idle");
        setError(`Could not start recording: ${(err as Error).message}`);
      }
    },
    [finishStop, lockScreen, wireWorker],
  );

  const pause = useCallback(() => {
    if (phaseRef.current !== "recording" || !audio.current) return;
    audio.current.node.port.postMessage({ type: "pause", paused: true });
    clock.current = { accumulated: elapsedNow(), since: null };
    setPhaseBoth("paused");
  }, []);

  const resume = useCallback(() => {
    if (phaseRef.current !== "paused" || !audio.current) return;
    audio.current.node.port.postMessage({ type: "pause", paused: false });
    clock.current = { accumulated: clock.current.accumulated, since: performance.now() };
    setPhaseBoth("recording");
  }, []);

  const finishInterrupted = useCallback(
    async (recordingId: number) => {
      const s = (await listSessions()).find((x) => x.recordingId === recordingId);
      if (!s) return;
      await putSession({ ...s, state: "finishing" });
      await refreshInterrupted();
      void pump();
    },
    [pump, refreshInterrupted],
  );

  const importFile = useCallback(
    async (m: MeetingRef, file: File) => {
      if (phaseRef.current !== "idle") return;
      setError(null);
      setNotice(null);
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) return setError(`Choose an audio file: ${IMPORT_EXTENSIONS.join(", ")}.`);
      if (file.size > MAX_IMPORT_BYTES) return setError(`That file is too large (max ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`);
      setPhaseBoth("importing");
      setNotice(`Preparing “${file.name}”…`);
      let recordingId: number | null = null;
      try {
        const r = await startRecordingAction(m.id, "uploaded", file.name);
        if (!r.ok) throw new Error(r.error);
        recordingId = r.recordingId;
        const id = recordingId;
        await putSession({ recordingId: id, meetingId: m.id, meetingTitle: m.title, startedAt: Date.now(), state: "recording" });
        if (DIRECT_IMPORT_TYPES[ext] && file.size <= MAX_DIRECT_IMPORT_BYTES) {
          // Small enough for the transcription provider as it is.
          await putSegment({ recordingId: id, index: 0, ext, blob: file, durationMs: await audioDuration(file) });
        } else {
          // ogg (not accepted by the provider) or large: convert to 16 kHz MP3 segments here.
          setNotice(`Converting “${file.name}” to MP3… (large files need a computer)`);
          const AC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
          const decoded = await new AC(1, 1, MP3_SAMPLE_RATE).decodeAudioData(await file.arrayBuffer());
          if (decoded.duration > MAX_RECORDING_SECONDS) throw new Error(`The file is longer than ${MAX_RECORDING_SECONDS / 3600} hours.`);
          const worker = newWorker();
          await new Promise<void>((resolve, reject) => {
            worker.onerror = (e) => reject(new Error(e.message || "the MP3 encoder stopped"));
            wireWorker(worker, id, async () => resolve());
            worker.postMessage({ type: "init", inputRate: decoded.sampleRate, segmentSeconds: segmentSeconds(), firstIndex: 0 });
            const step = decoded.sampleRate * 30;
            const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
            for (let i = 0; i < decoded.length; i += step) {
              const n = Math.min(step, decoded.length - i);
              const mono = new Float32Array(n);
              for (const ch of channels) for (let j = 0; j < n; j++) mono[j] += ch[i + j] / channels.length;
              worker.postMessage({ type: "pcm", data: mono }, [mono.buffer]);
            }
            worker.postMessage({ type: "flush" });
          });
          await writes.current;
          worker.terminate();
        }
        await putSession({ recordingId: id, meetingId: m.id, meetingTitle: m.title, startedAt: Date.now(), state: "finishing" });
        setNotice(`Uploading “${file.name}”…`);
        void pump();
      } catch (err) {
        if (recordingId) {
          for (const s of (await listSegments()).filter((x) => x.recordingId === recordingId)) await deleteSegment(s.recordingId, s.index);
          await deleteSession(recordingId).catch(() => {});
          await finishRecordingAction(recordingId, m.id).catch(() => {});
        }
        setError(`Could not import the file: ${(err as Error).message}`);
        setNotice(null);
      } finally {
        setPhaseBoth("idle");
      }
    },
    [pump, wireWorker],
  );

  const value: Recorder = {
    supported,
    phase,
    meeting,
    recordingId: activeId.current,
    elapsedMs,
    level,
    queued,
    uploading,
    uploadedParts,
    uploadError,
    error,
    notice,
    interrupted,
    persistent,
    wakeLock: typeof navigator !== "undefined" && "wakeLock" in navigator,
    start,
    pause,
    resume,
    stop,
    finishInterrupted,
    importFile,
    dismiss: () => {
      setError(null);
      setNotice(null);
    },
  };
  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}
