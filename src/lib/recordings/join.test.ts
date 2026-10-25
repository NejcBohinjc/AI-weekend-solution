import assert from "node:assert/strict";
import { test } from "node:test";
import { FAILED_PART_TEXT, formatOffset, joinTranscripts } from "./join";

test("offsets", () => {
  assert.equal(formatOffset(0), "00:00:00");
  assert.equal(formatOffset(600_000), "00:10:00");
  assert.equal(formatOffset(3 * 3_600_000 + 61_500), "03:01:01");
});

test("parts are joined in order with the time each starts at; failed parts are marked, empty parts skipped", () => {
  const text = joinTranscripts([
    { index: 2, durationMs: 120_000, text: "Konec." },
    { index: 0, durationMs: 600_000, text: "  Pozdravljeni vsi. " },
    { index: 1, durationMs: 600_000, text: null, failed: true },
    { index: 3, durationMs: 1000, text: "" },
  ]);
  assert.equal(text, `[00:00:00] Pozdravljeni vsi.\n\n[00:10:00] ${FAILED_PART_TEXT}\n\n[00:20:00] Konec.`);
});
