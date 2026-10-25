// Office / home split of hours. Pure (tested in location.test.ts).
import { LOCATION_LABELS, type WorkLocation } from "./constants";
import { overlapMs } from "./time";

export type LocationKey = WorkLocation | "unspecified";
export type LocationTotals = Record<LocationKey, number>;

export function emptyLocationTotals(): LocationTotals {
  return { office: 0, home: 0, unspecified: 0 };
}

/** Time per location inside [from, to) in ms. Entries without a location count as "unspecified". */
export function locationTotals(
  entries: { startedAt: Date; endedAt: Date | null; location: WorkLocation | null }[],
  from: Date,
  to: Date,
  now: Date,
): LocationTotals {
  const totals = emptyLocationTotals();
  for (const e of entries) totals[e.location ?? "unspecified"] += overlapMs(e.startedAt, e.endedAt, from, to, now);
  return totals;
}

export function locationLabel(location: WorkLocation | null): string {
  return LOCATION_LABELS[location ?? "unspecified"];
}

export function parseLocation(value: unknown): WorkLocation | null {
  return value === "office" || value === "home" ? value : null;
}
