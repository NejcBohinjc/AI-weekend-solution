// Web Worker around SegmentEncoder: the recorder posts PCM blocks, the worker posts finished MP3
// segments back as Blobs.
import { Mp3Encoder } from "@breezystack/lamejs";
import { SegmentEncoder } from "./segment-encoder";

type In = { type: "init"; inputRate: number; segmentSeconds: number; firstIndex: number } | { type: "pcm"; data: Float32Array } | { type: "flush" };

const ctx = self as unknown as { postMessage(msg: unknown): void; onmessage: ((e: MessageEvent<In>) => void) | null };
let enc: SegmentEncoder | null = null;

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    enc = new SegmentEncoder(Mp3Encoder, msg.inputRate, msg.segmentSeconds, msg.firstIndex, (s) =>
      ctx.postMessage({ type: "segment", index: s.index, durationMs: s.durationMs, blob: new Blob(s.data as BlobPart[], { type: "audio/mpeg" }) }),
    );
  } else if (msg.type === "pcm") {
    enc?.write(msg.data);
  } else if (msg.type === "flush") {
    enc?.finishSegment();
    ctx.postMessage({ type: "done", nextIndex: enc?.nextIndex ?? 0 });
  }
};
