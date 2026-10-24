// Stopping a timer, separate from the server action so the whole path can be tested against the database.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { timeEntries } from "@/db/schema";
import { FORGOTTEN_TIMER_HOURS, MIN_ENTRY_SECONDS } from "./constants";
import { runningEntry } from "./queries";
import { checkLength, fromLocalInput } from "./time";

export type StopResult =
  | { kind: "none" } // no timer was running (already stopped, e.g. on another device)
  | { kind: "discarded" } // ran under MIN_ENTRY_SECONDS
  | { kind: "saved"; entryId: number; ms: number }
  | { kind: "ask"; startedAt: Date; error?: string }; // ask when the member actually stopped

/**
 * Stops the member's running timer at `now`, or at `endedAtInput` (Ljubljana local time, from the
 * "when did you stop?" form). A saved entry gets its end time and is queued for the sheet.
 */
export async function stopTimer(memberId: number, { now = new Date(), endedAtInput }: { now?: Date; endedAtInput?: string | null } = {}): Promise<StopResult> {
  const running = await runningEntry(memberId);
  if (!running) return { kind: "none" };
  const ask = (error?: string): StopResult => ({ kind: "ask", startedAt: running.startedAt, error });

  let endedAt = now;
  if (endedAtInput) {
    const at = fromLocalInput(endedAtInput);
    if (!at) return ask("Pick when you stopped.");
    if (at.getTime() > now.getTime() + 60_000) return ask("That is in the future.");
    endedAt = at;
  } else if (now.getTime() - running.startedAt.getTime() > FORGOTTEN_TIMER_HOURS * 3_600_000) {
    return ask();
  }

  const ms = endedAt.getTime() - running.startedAt.getTime();
  if (ms < MIN_ENTRY_SECONDS * 1000 && !endedAtInput) {
    await db.delete(timeEntries).where(and(eq(timeEntries.id, running.id), isNull(timeEntries.endedAt)));
    return { kind: "discarded" };
  }
  const tooLong = checkLength(running.startedAt, endedAt);
  if (tooLong) return ask(tooLong.error);

  const [saved] = await db
    .update(timeEntries)
    .set({ endedAt, sheetStatus: "pending", sheetError: null, updatedAt: new Date() })
    .where(and(eq(timeEntries.id, running.id), isNull(timeEntries.endedAt)))
    .returning({ id: timeEntries.id });
  // Someone stopped it a moment earlier (another tab or device): nothing left to do.
  return saved ? { kind: "saved", entryId: saved.id, ms } : { kind: "none" };
}
