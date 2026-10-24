import { getSyncState } from "@/lib/sync-state";
import { TASKS_SYNC } from "./sheet-sync";

export type TasksSyncStatus = { lastFinishedAt: string | null; running: boolean; ok: boolean | null; error: string | null };

/** For the "Synced 12 s ago" line. The error (e.g. "403 PERMISSION_DENIED: ...") is shown to everyone. */
export async function tasksSyncStatus(): Promise<TasksSyncStatus> {
  const s = await getSyncState(TASKS_SYNC);
  const stale = s?.runningSince && Date.now() - s.runningSince.getTime() > 5 * 60_000;
  return {
    lastFinishedAt: s?.lastFinishedAt?.toISOString() ?? null,
    running: !!s?.runningSince && !stale,
    ok: s?.lastOk ?? null,
    error: s?.lastError ?? null,
  };
}
