"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { TIMEZONE } from "@/lib/app";
import type { TasksSyncStatus } from "@/lib/tasks/sync-status";
import { syncNowAction } from "./actions";

const STALE_MS = 60_000;

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `at ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE })}`;
}

/**
 * "Synced 12 s ago · Sync now". The page starts a background sync when the last one is over a minute
 * old; this polls until it finishes and then refreshes the page, so the page itself never waits.
 */
export function SyncStatus({ initial }: { initial: TasksSyncStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [result, syncNow, syncing] = useActionState(syncNowAction, null);
  const [polling, setPolling] = useState(() => initial.running || !initial.lastFinishedAt || Date.now() - new Date(initial.lastFinishedAt).getTime() > STALE_MS);
  const seen = useRef(initial.lastFinishedAt);

  useEffect(() => setStatus(initial), [initial]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // "Sync now" found another sync running: wait for that one.
  useEffect(() => {
    if (result && !result.ran) setPolling(true);
  }, [result]);

  useEffect(() => {
    if (!polling) return;
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const res = await fetch("/api/tasks/sync-status", { cache: "no-store" });
        if (res.ok) {
          const next: TasksSyncStatus = await res.json();
          setStatus(next);
          if (!next.running && next.lastFinishedAt && next.lastFinishedAt !== seen.current) {
            seen.current = next.lastFinishedAt;
            setPolling(false);
            router.refresh();
          }
        }
      } catch {
        // offline for a moment: try again on the next tick
      }
      if (tries >= 20) setPolling(false);
    }, 2000);
    return () => clearInterval(t);
  }, [polling, router]);

  const running = syncing || status.running;
  const label = running
    ? "Syncing with the sheet…"
    : !status.lastFinishedAt
      ? "Not synced with the sheet yet"
      : status.ok === false
        ? `Last sync failed ${ago(status.lastFinishedAt, now)}`
        : `Synced ${ago(status.lastFinishedAt, now)}`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="sync-status">
      <span className={status.ok === false && !running ? "text-red-700" : "text-slate-500"} suppressHydrationWarning>
        {label}
      </span>
      <form action={syncNow}>
        <button type="submit" disabled={running} className="font-medium text-slate-900 underline underline-offset-2 disabled:text-slate-400 disabled:no-underline">
          Sync now
        </button>
      </form>
      {result?.ok && !syncing && <span className="text-slate-500">{result.summary}</span>}
      {status.error && status.ok === false && !running && <span className="w-full text-xs text-red-700">{status.error}</span>}
    </div>
  );
}
