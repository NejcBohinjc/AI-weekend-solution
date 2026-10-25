// Shared by the analytics tests (not a test itself).
import type { WorkLocation } from "@/lib/hours/constants";
import { addDays, overlapMs, weekBounds, weekStartOf } from "@/lib/hours/time";
import type { Data } from "./compute";

export type Entry = { memberId: number; startedAt: Date; endedAt: Date | null; location?: WorkLocation | null };

/** What load.ts computes in SQL, done the plain way (overlapMs) for the last 26 weeks: the reference. */
export function weeklyHours(entries: Entry[], at: Date): Data["hours"] {
  const thisWeek = weekStartOf(at);
  const out = new Map<string, Data["hours"][number]>();
  for (let i = 0; i < 26; i++) {
    const week = addDays(thisWeek, -7 * i);
    const { from, to } = weekBounds(week);
    for (const e of entries) {
      const ms = overlapMs(e.startedAt, e.endedAt, from, to, at);
      if (ms <= 0) continue;
      const key = `${e.memberId}|${week}|${e.location ?? ""}`;
      const row = out.get(key) ?? { memberId: e.memberId, week, location: e.location ?? null, ms: 0 };
      row.ms += ms;
      out.set(key, row);
    }
  }
  return [...out.values()];
}
