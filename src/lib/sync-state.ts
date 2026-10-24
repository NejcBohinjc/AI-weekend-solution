// Leases and status for background syncs, stored in Postgres so they hold across serverless instances.
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { syncState } from "@/db/schema";

// A sync that has been "running" this long is assumed to have crashed; another one may start.
const STALE_LEASE = "5 minutes";

/**
 * Takes the lease for `name` if no sync is running and (unless `force`) the last one finished
 * at least `minIntervalSeconds` ago. Returns false if another sync has it or it is too soon.
 */
export async function acquireSync(name: string, { minIntervalSeconds = 0, force = false } = {}): Promise<boolean> {
  await db.insert(syncState).values({ name }).onConflictDoNothing();
  const rows = await db.execute(sql`
    update sync_state set running_since = now(), last_started_at = now()
    where name = ${name}
      and (running_since is null or running_since < now() - ${STALE_LEASE}::interval)
      and (${force} or last_finished_at is null or last_finished_at < now() - make_interval(secs => ${minIntervalSeconds}))
    returning name`);
  return rows.length > 0;
}

export async function finishSync(name: string, result: { ok: boolean; error?: string | null }): Promise<void> {
  await db
    .update(syncState)
    .set({ runningSince: null, lastFinishedAt: new Date(), lastOk: result.ok, lastError: result.ok ? null : (result.error ?? "unknown error") })
    .where(eq(syncState.name, name));
}

/** Records the outcome of a run that does not use the lease (e.g. the hours sync). */
export async function recordSyncResult(name: string, result: { ok: boolean; error?: string | null }): Promise<void> {
  const now = new Date();
  await db
    .insert(syncState)
    .values({ name, lastStartedAt: now, lastFinishedAt: now, lastOk: result.ok, lastError: result.ok ? null : (result.error ?? null) })
    .onConflictDoUpdate({
      target: syncState.name,
      set: { lastFinishedAt: now, lastOk: result.ok, lastError: result.ok ? null : (result.error ?? null) },
    });
}

export async function getSyncState(name: string) {
  const [row] = await db.select().from(syncState).where(eq(syncState.name, name)).limit(1);
  return row ?? null;
}
