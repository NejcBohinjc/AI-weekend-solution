"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorClass, primaryButtonClass } from "@/components/ui";
import { formatBytes, formatSeconds, isVideo, recordingFileProblem } from "@/lib/meetings/recordings";
import { uploadRecording } from "./upload-recording";

/** The length of an audio or video file, read by the browser; null if it cannot tell. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(isVideo(file.type) ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

/** Admins upload the recording of a meeting that has happened (an audio file, or an MP4/WebM/MOV video). */
export function RecordingUploadForm({ meetingId }: { meetingId: number }) {
  const router = useRouter();
  const [file, setFile] = useState<{ file: File; seconds: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function choose(f: File | undefined) {
    setError(null);
    setFile(null);
    if (!f) return;
    const problem = recordingFileProblem({ contentType: f.type, size: f.size });
    if (problem) return setError(problem);
    setFile({ file: f, seconds: await readDuration(f) });
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setProgress(0);
    const result = await uploadRecording({
      meetingId,
      blob: file.file,
      fileName: file.file.name,
      source: "uploaded",
      durationSeconds: file.seconds,
      onProgress: setProgress,
    });
    setProgress(null);
    if (result.error) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="recording-upload">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Upload the recording of this meeting</span>
        <input
          type="file"
          accept="audio/*,video/mp4,video/webm,video/quicktime"
          disabled={progress !== null}
          onChange={(e) => choose(e.target.files?.[0])}
          className="max-w-full text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-medium"
        />
      </label>
      {file && (
        <p className="text-xs text-subtle">
          {file.file.name} · {formatBytes(file.file.size)}
          {file.seconds !== null && ` · ${formatSeconds(file.seconds)}`}
        </p>
      )}
      {progress !== null ? (
        <div className="flex flex-col gap-1" role="status">
          <p className="text-sm text-fg-2">Uploading… {Math.round(progress * 100)}%</p>
          <progress value={progress} max={1} className="h-2 w-full" aria-label="Upload progress" />
        </div>
      ) : (
        file && (
          <button type="button" onClick={upload} className={`${primaryButtonClass} self-start py-2 text-sm`}>
            Upload recording
          </button>
        )
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
    </div>
  );
}
