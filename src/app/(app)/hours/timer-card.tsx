"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { Arrow } from "@/components/ui-kit";
import { TIMEZONE } from "@/lib/app";
import { measureSkew, serverNowMs } from "@/lib/hours/clock";
import { LOCATION_LABELS, type WorkLocation } from "@/lib/hours/constants";
import { LocationToggle } from "./location-toggle";
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

/** A page older than this when it is shown came from the router cache: fetch a fresh one. */
const STALE_PAGE_MS = 2000;

/**
 * Start/Stop for the signed-in member. The elapsed time is computed only from the entry's startedAt
 * and the current time (corrected by the server clock offset from /api/time), never from a time baked
 * into the page, which may be a stale copy from the router cache. Coming back to the page (mount,
 * tab focus) refreshes it from the server, so a timer started or stopped elsewhere shows correctly.
 */
export function TimerCard({
  startedAt,
  renderedAt,
  location,
  defaultLocation,
}: {
  startedAt: string | null;
  renderedAt: string;
  /** Where the running timer was started (null: before locations existed). */
  location?: WorkLocation | null;
  /** The member's last choice, preselected for the next Start. */
  defaultLocation: WorkLocation;
}) {
  const router = useRouter();
  const [startState, startAction, starting] = useActionState(startTimerAction, {});
  const [stopState, stopAction, stopping] = useActionState(stopTimerAction, {} as TimerState);
  const [discardState, discardAction, discarding] = useActionState(discardTimerAction, {});
  // Server render: the render time. In the browser: this device's clock (corrected once measured).
  const [now, setNow] = useState(() => (typeof window === "undefined" ? new Date(renderedAt).getTime() : serverNowMs()));
  const lastRefresh = useRef(0);

  // Fresh state whenever the member comes back: on mount if this page is a cached copy, and on tab focus.
  useEffect(() => {
    const refresh = () => {
      if (Date.now() - lastRefresh.current < 1000) return; // focus and visibilitychange fire together
      lastRefresh.current = Date.now();
      router.refresh();
    };
    measureSkew().then(() => {
      setNow(serverNowMs());
      if (serverNowMs() - new Date(renderedAt).getTime() > STALE_PAGE_MS) refresh();
    });
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      measureSkew().then(() => setNow(serverNowMs()));
      refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [router, renderedAt]);

  useEffect(() => {
    if (!startedAt) return;
    setNow(serverNowMs());
    const timer = setInterval(() => setNow(serverNowMs()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const running = startedAt !== null;
  const askEnd = running && stopState.askEnd;
  const notice = !running ? (stopState.notice ?? discardState.notice) : undefined;
  const error = startState.error ?? stopState.error;

  return (
    <section aria-label="Timer" className="flex flex-col gap-4" data-testid="timer">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className={`text-sm font-medium ${running ? "text-success" : "text-subtle"}`}>
          {running
            ? `Working since ${startLabel(startedAt, now)}${location ? ` · ${LOCATION_LABELS[location].toLowerCase()}` : ""}`
            : "Not tracking"}
        </p>
        <p className="font-display text-[clamp(2.75rem,12vw,4rem)] font-semibold leading-none tabular-nums tracking-display" suppressHydrationWarning>
          {running ? clock(now - new Date(startedAt).getTime()) : "0:00:00"}
        </p>
      </div>

      {askEnd ? (
        <form action={stopAction} className="flex flex-col gap-3 rounded-xl bg-warning-bg p-3">
          <p className="text-sm text-warning">
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
            <button type="submit" disabled={stopping} className="flex-1 rounded-pill bg-danger-solid px-4 py-3 font-display font-semibold text-on-primary hover:bg-danger-solid-hover disabled:opacity-60">
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
            className="w-full rounded-pill bg-danger-solid px-6 py-4 font-display text-lg font-semibold text-on-primary transition hover:bg-danger-solid-hover disabled:opacity-60"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </form>
      ) : (
        <form action={startAction} className="flex flex-col gap-2">
          <LocationToggle defaultValue={defaultLocation} />
          <button
            type="submit"
            disabled={starting}
            className={`group w-full py-4 text-lg ${primaryButtonClass}`}
          >
            {starting ? "Starting…" : "Start the timer"}
            {!starting && <Arrow />}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-center text-sm text-muted">
          {notice}
        </p>
      )}
    </section>
  );
}
