"use client";

import { useActionState, useEffect, useState } from "react";
import { errorClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";
import { discardTimerAction, startTimerAction, stopTimerAction, type TimerState } from "./actions";

/** "2:14:37" */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "12:53", or "Fri 22:59" when the timer was started on another day. */
function startLabel(iso: string, nowMs: number): string {
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const start = new Date(iso);
  return start.toLocaleString("en-GB", {
    ...(day(start.getTime()) !== day(nowMs) && { weekday: "short" }),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

/** "2026-10-24T17:30" in Ljubljana time, for a datetime-local input. */
function localInput(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * Start/Stop for the signed-in member. The start time lives on the server, so the counter is right
 * after a reload, on another device, or if the phone's clock is off (serverNow corrects for that).
 */
export function TimerCard({ startedAt, serverNow }: { startedAt: string | null; serverNow: string }) {
  const [startState, startAction, starting] = useActionState(startTimerAction, {});
  const [stopState, stopAction, stopping] = useActionState(stopTimerAction, {} as TimerState);
  const [discardState, discardAction, discarding] = useActionState(discardTimerAction, {});
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => new Date(serverNow).getTime());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now() + offset);
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [startedAt, offset]);

  const running = startedAt !== null;
  const askEnd = running && stopState.askEnd;
  const notice = !running ? (stopState.notice ?? discardState.notice) : undefined;
  const error = startState.error ?? stopState.error;

  return (
    <section aria-label="Timer" className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="timer">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className={`text-sm ${running ? "font-medium text-emerald-700" : "text-slate-500"}`}>
          {running ? `Working since ${startLabel(startedAt, now)}` : "Not tracking"}
        </p>
        <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight" suppressHydrationWarning>
          {running ? clock(now - new Date(startedAt).getTime()) : "0:00:00"}
        </p>
      </div>

      {askEnd ? (
        <form action={stopAction} className="flex flex-col gap-3 rounded-xl bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            Your timer has been running since {startLabel(askEnd.startedAt, now)}. When did you stop?
          </p>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Stopped at</span>
            <input
              type="datetime-local"
              name="endedAt"
              required
              min={localInput(new Date(askEnd.startedAt).getTime() + 60_000)}
              max={localInput(now)}
              defaultValue={localInput(Math.min(now, new Date(askEnd.startedAt).getTime() + 8 * 3_600_000))}
              className={inputClass}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={stopping} className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {stopping ? "Saving…" : "Save and stop"}
            </button>
            <button type="submit" formAction={discardAction} formNoValidate disabled={discarding} className={secondaryButtonClass}>
              Discard
            </button>
          </div>
        </form>
      ) : running ? (
        <form action={stopAction}>
          <button
            type="submit"
            disabled={stopping}
            className="w-full rounded-xl bg-red-600 px-4 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </form>
      ) : (
        <form action={startAction}>
          <button
            type="submit"
            disabled={starting}
            className="w-full rounded-xl bg-emerald-600 px-4 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {starting ? "Starting…" : "Start"}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-center text-sm text-slate-600">
          {notice}
        </p>
      )}
    </section>
  );
}
