// Sending the claimed reminder emails, shared by the meeting and the task reminder jobs. The jobs claim
// what is due in a SHORT database transaction (take the lock, find what is due, insert the reminder rows
// as "pending"), commit, and only then call deliver(): no network traffic happens while a transaction
// (and the pooled connection it holds) is open, so a slow mail server cannot exhaust the pool and hang
// the pages. One failing email never stops the rest.
import { sendEmail, type OutgoingEmail } from "@/lib/email";
import type { EmailStatus } from "@/lib/meetings/constants";

export type ReminderRun = {
  ran: boolean;
  emails: number;
  sent: number;
  logged: number;
  failed: number;
  /** Due but left for the next run: over the per-run cap, or out of time. */
  deferred: number;
};
export const emptyRun = (): ReminderRun => ({ ran: false, emails: 0, sent: 0, logged: 0, failed: 0, deferred: 0 });

/** A pending reminder row that was claimed but not finished for this long is claimed again (its run died). */
export const PENDING_RETRY_MS = 10 * 60_000;
export const MAX_EMAILS_PER_RUN = 50;
/** Total time a run may spend sending; the cron route's function limit is higher. */
export const DEFAULT_SEND_BUDGET_MS = 40_000;
const CONCURRENCY = 4;

export type SendResult = { id: number | null; status: EmailStatus; error?: string };
export type RunOptions = { deadline?: number; maxEmails?: number; concurrency?: number; send?: (mail: OutgoingEmail) => Promise<SendResult> };

export type Claimed = {
  mail: OutgoingEmail;
  /** Records the outcome on the reminder rows (sent or failed). */
  finish: (result: SendResult) => Promise<void>;
  /** Gives the claim back (deletes the pending rows) so the next run sends it. */
  release: () => Promise<void>;
};

const failMessage = (err: unknown) => (err as Error)?.message ?? "unknown error";

export async function deliver(items: Claimed[], run: ReminderRun, { deadline = Date.now() + DEFAULT_SEND_BUDGET_MS, send = sendEmail, concurrency = CONCURRENCY }: RunOptions = {}): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const item = items[next++];
      if (!item) return;
      if (Date.now() >= deadline) {
        await item.release().catch((err) => console.error("[reminders] release:", failMessage(err)));
        run.deferred++;
        continue;
      }
      let result: SendResult;
      try {
        result = await send(item.mail);
      } catch (err) {
        result = { id: null, status: "failed", error: failMessage(err) };
      }
      try {
        await item.finish(result);
      } catch (err) {
        console.error("[reminders] could not record the result:", failMessage(err));
      }
      run.emails++;
      run[result.status]++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
