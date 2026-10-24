"use client";

// Server clock offset for the timer display. Measured from /api/time (never a value from a page,
// which may come from the router cache and be minutes old). Shared by every TimerCard on the page.

let skewMs = 0;
let pending: Promise<number> | null = null;

/** Server time minus this device's time, corrected for half the round trip. */
export function measureSkew(): Promise<number> {
  pending ??= (async () => {
    try {
      const t0 = Date.now();
      const res = await fetch("/api/time", { cache: "no-store" });
      const t1 = Date.now();
      if (res.ok) {
        const { now } = (await res.json()) as { now: number };
        skewMs = now + (t1 - t0) / 2 - t1;
      }
    } catch {
      // offline: keep the last known offset
    } finally {
      pending = null;
    }
    return skewMs;
  })();
  return pending;
}

/** The current time on the server's clock, as best we know it. */
export function serverNowMs(): number {
  return Date.now() + skewMs;
}
