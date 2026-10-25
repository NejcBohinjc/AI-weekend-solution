// Hours per day of one week, for the "day by day" chart. Pure (tested in daily.test.ts). Days are
// Europe/Ljubljana calendar days and entries are clipped to them exactly like weeks are (overlapMs), so
// the seven days always add up to the week's total, also in the week the clocks change.
import type { WorkLocation } from "./constants";
import { locationTotals } from "./location";
import { addDays, ljubljanaParts, ljubljanaToUtc } from "./time";

const HOUR = 3_600_000;

export type DayHours = {
  date: string; // yyyy-mm-dd
  /** "Mon" */
  weekday: string;
  /** "Mon 20 Oct" */
  label: string;
  hours: number;
  office: number;
  home: number;
  unspecified: number;
  today: boolean;
  /** After today: nothing can have been logged yet. */
  future: boolean;
};

export function dailyHours(
  entries: { startedAt: Date; endedAt: Date | null; location: WorkLocation | null }[],
  weekStart: string,
  now: Date,
): DayHours[] {
  const today = ljubljanaParts(now).date;
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const t = locationTotals(entries, ljubljanaToUtc(date, "00:00"), ljubljanaToUtc(addDays(date, 1), "00:00"), now);
    const d = new Date(`${date}T12:00:00Z`);
    const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
    const weekday = part({ weekday: "short" });
    return {
      date,
      weekday,
      // Built from parts: the order and commas of one combined format differ between ICU versions.
      label: `${weekday} ${part({ day: "numeric" })} ${part({ month: "short" })}`,
      hours: (t.office + t.home + t.unspecified) / HOUR,
      office: t.office / HOUR,
      home: t.home / HOUR,
      unspecified: t.unspecified / HOUR,
      today: date === today,
      future: date > today,
    };
  });
}

/** "14 Sep": fixed short month names (toLocaleDateString gives "Sept" in some ICU versions, too wide for a column). */
export function shortDay(date: string): string {
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1];
  return `${Number(date.slice(8, 10))} ${m}`;
}
