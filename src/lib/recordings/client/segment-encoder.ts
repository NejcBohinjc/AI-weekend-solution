// PCM in, MP3 segments out: resamples mono PCM (any rate) to 16 kHz, encodes 32 kbps MP3 as it goes and
// emits a segment every `segmentSeconds`. Only the current segment's MP3 bytes are held (~2.4 MB),
// never the raw meeting. Runs in the MP3 Web Worker; tested in Node (segment-encoder.test.ts).
import { MP3_KBPS, MP3_SAMPLE_RATE } from "../constants";

export type EncodedSegment = { index: number; data: Uint8Array[]; durationMs: number };
/** lamejs's Mp3Encoder (passed in: the worker imports it statically, Node tests load its ESM build). */
export type Mp3EncoderClass = new (channels: number, sampleRate: number, kbps: number) => { encodeBuffer(left: Int16Array): Uint8Array; flush(): Uint8Array };

export class SegmentEncoder {
  private ratio: number;
  private segmentSamples: number;
  private index: number;
  private encoder: InstanceType<Mp3EncoderClass>;
  private chunks: Uint8Array[] = [];
  private samples = 0; // output samples in the current segment
  // Box-filter resampler: averages the input samples that fall into each output sample.
  private acc = 0;
  private count = 0;
  private pos = 0;

  constructor(
    private Encoder: Mp3EncoderClass,
    inputRate: number,
    segmentSeconds: number,
    firstIndex: number,
    private onSegment: (s: EncodedSegment) => void,
  ) {
    this.ratio = inputRate / MP3_SAMPLE_RATE;
    this.segmentSamples = segmentSeconds * MP3_SAMPLE_RATE;
    this.index = firstIndex;
    this.encoder = new Encoder(1, MP3_SAMPLE_RATE, MP3_KBPS);
  }

  get nextIndex() {
    return this.index;
  }

  write(input: Float32Array) {
    const out = new Int16Array(Math.ceil(input.length / this.ratio) + 2);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i];
      this.count++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        const v = Math.max(-1, Math.min(1, this.acc / this.count));
        // Usually one output sample; several when the input rate is below 16 kHz.
        while (this.pos >= this.ratio) {
          this.pos -= this.ratio;
          out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        this.acc = 0;
        this.count = 0;
      }
    }
    let start = 0;
    while (start < n) {
      // Never let a segment run past its length: split the block at the boundary.
      const take = Math.min(n - start, this.segmentSamples - this.samples);
      const mp3 = this.encoder.encodeBuffer(out.subarray(start, start + take));
      if (mp3.length) this.chunks.push(new Uint8Array(mp3));
      this.samples += take;
      start += take;
      if (this.samples >= this.segmentSamples) this.finishSegment();
    }
  }

  /** Ends the current segment (if it has any audio). */
  finishSegment() {
    const tail = this.encoder.flush();
    if (tail.length) this.chunks.push(new Uint8Array(tail));
    if (this.samples > 0) {
      this.onSegment({ index: this.index, data: this.chunks, durationMs: Math.round((this.samples / MP3_SAMPLE_RATE) * 1000) });
      this.index++;
    }
    this.encoder = new this.Encoder(1, MP3_SAMPLE_RATE, MP3_KBPS);
    this.chunks = [];
    this.samples = 0;
  }
}
