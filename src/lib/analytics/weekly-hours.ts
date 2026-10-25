// Hours per member, week and location, added up in SQL (see load.ts for why). Its own module so it can be
// tested against the plain JavaScript way (overlapMs) in weekly-hours.test.ts.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { WorkLocation } from "@/lib/hours/constants";
import { weekBounds } from "@/lib/hours/time";
import type { Data, Range } from "./compute";

/** How many weeks of data a range needs. "4 weeks" also needs the 4 full weeks before this one (drifting members). */
export function weeksNeeded(range: Range): number {
  return range === "4w" ? 5 : range === "8w" ? 8 : 26;
}

/** Hours per member, week and location in ms, for the given weeks (Mondays). One statement. */
export async function loadWeeklyHours(weeks: string[], now: Date): Promise<Data["hours"]> {
  const nowIso = now.toISOString();
  const weekRows = sql.join(
    weeks.map((w) => {
      const b = weekBounds(w);
      return sql`(${w}::text, ${b.from.toISOString()}::timestamptz, ${b.to.toISOString()}::timestamptz)`;
    }),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    with weeks(week, w_from, w_to) as (values ${weekRows})
    select e.member_id, w.week, e.location,
           round(sum(extract(epoch from (least(coalesce(e.ended_at, ${nowIso}::timestamptz), w.w_to) - greatest(e.started_at, w.w_from))) * 1000))::float8 as ms
    from weeks w
    join time_entries e
      on e.deleted_at is null and e.started_at < w.w_to and coalesce(e.ended_at, ${nowIso}::timestamptz) > w.w_from
    group by e.member_id, w.week, e.location`)) as unknown as { member_id: number; week: string; location: WorkLocation | null; ms: number }[];
  return rows.map((r) => ({ memberId: r.member_id, week: r.week, location: r.location, ms: Number(r.ms) }));
}
