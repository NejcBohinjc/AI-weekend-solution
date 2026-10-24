import assert from "node:assert/strict";
import { test } from "node:test";
import { joinMp3, stripId3 } from "./mp3-join";
import { SegmentEncoder, type EncodedSegment, type Mp3EncoderClass } from "./segment-encoder";

// The package's CommonJS entry is broken; its ES module build is what the browser bundle uses too.
const loadEncoder = async () => (await import("@breezystack/lamejs")).Mp3Encoder as Mp3EncoderClass;

const tone = (rate: number, seconds: number) => {
  const a = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < a.length; i++) a[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return a;
};

test("48 kHz input becomes 16 kHz MP3 segments of the set length; the last one is the remainder", async () => {
  const out: EncodedSegment[] = [];
  const enc = new SegmentEncoder(await loadEncoder(), 48_000, 2, 0, (s) => out.push(s));
  const pcm = tone(48_000, 5);
  for (let i = 0; i < pcm.length; i += 4096) enc.write(pcm.subarray(i, i + 4096)); // blocks as the worklet sends them
  enc.finishSegment();
  assert.deepEqual(out.map((s) => [s.index, s.durationMs]), [[0, 2000], [1, 2000], [2, 1000]]);
  const bytes = out[0].data.reduce((n, c) => n + c.length, 0);
  assert.ok(bytes > 7000 && bytes < 10_000, `about 32 kbps: ${bytes} bytes for 2 s`);
  assert.equal(out[0].data[0][0], 0xff, "starts with an MPEG frame sync");
  enc.finishSegment();
  assert.equal(out.length, 3, "an empty segment is not emitted");
});

test("44.1 kHz and 8 kHz inputs keep their real duration", async () => {
  const Encoder = await loadEncoder();
  for (const rate of [44_100, 8000]) {
    const out: EncodedSegment[] = [];
    const enc = new SegmentEncoder(Encoder, rate, 600, 4, (s) => out.push(s));
    enc.write(tone(rate, 3));
    enc.finishSegment();
    assert.equal(out.length, 1);
    assert.equal(out[0].index, 4);
    assert.ok(Math.abs(out[0].durationMs - 3000) <= 2, `${rate}: ${out[0].durationMs} ms`);
  }
});

test("joining MP3 parts strips ID3 tags and keeps the frames", () => {
  const frames = new Uint8Array([0xff, 0xf3, 1, 2, 3]);
  const id3v2 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 9, 9, ...frames]);
  assert.deepEqual([...stripId3(id3v2)], [...frames]);
  const tag = new Uint8Array(128);
  tag.set([0x54, 0x41, 0x47]);
  const withV1 = new Uint8Array([...frames, ...tag]);
  assert.deepEqual([...stripId3(withV1)], [...frames]);
  assert.deepEqual([...joinMp3([id3v2, withV1])], [...frames, ...frames]);
});
