// Browser side of a recording upload (see recording-actions.ts): get an upload URL, PUT the file with
// progress, then confirm. Used by the in-room recorder and by the admin upload form.
import type { RecordingSource } from "@/lib/meetings/constants";
import { finishRecordingUploadAction, startRecordingUploadAction } from "./recording-actions";

type Options = {
  meetingId: number;
  blob: Blob;
  fileName: string | null;
  source: RecordingSource;
  durationSeconds: number | null;
  onProgress: (fraction: number) => void;
};

function put(url: string, blob: Blob, contentType: string, onProgress: (fraction: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(blob);
  });
}

export async function uploadRecording({ meetingId, blob, fileName, source, durationSeconds, onProgress }: Options): Promise<{ error?: string }> {
  const contentType = blob.type || "application/octet-stream";
  const start = await startRecordingUploadAction(meetingId, { source, fileName, contentType, size: blob.size, durationSeconds });
  if ("error" in start) return { error: start.error };
  const status = await put(start.url, blob, start.contentType, onProgress);
  if (status < 200 || status >= 300) {
    return { error: status ? `The upload was refused (HTTP ${status}). Try again.` : "The upload did not get through. Check the connection and try again." };
  }
  return finishRecordingUploadAction(start.recordingId);
}
