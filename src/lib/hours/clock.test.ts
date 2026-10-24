import assert from "node:assert/strict";
import { test } from "node:test";
import { measureSkew, serverNowMs } from "./clock";

test("the timer clock follows the server time from /api/time, not the device clock", async () => {
  const realFetch = globalThis.fetch;
  // The server is 5 minutes ahead of this device.
  globalThis.fetch = (async () => new Response(JSON.stringify({ now: Date.now() + 5 * 60_000 }))) as typeof fetch;
  try {
    await measureSkew();
    assert.ok(Math.abs(serverNowMs() - (Date.now() + 5 * 60_000)) < 1000);
    // Elapsed time of a timer started 90 s ago on the server's clock.
    const startedAt = Date.now() + 5 * 60_000 - 90_000;
    assert.equal(Math.round((serverNowMs() - startedAt) / 1000), 90);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a failed /api/time call keeps the last known offset", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    const before = serverNowMs() - Date.now();
    await measureSkew();
    assert.ok(Math.abs(serverNowMs() - Date.now() - before) < 50);
  } finally {
    globalThis.fetch = realFetch;
  }
});
