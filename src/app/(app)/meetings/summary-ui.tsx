"use client";

// The Summary section of a meeting: the AI summary (3-6 bullets), when and by which model it was made, and
// for admins "Summarise" / "Regenerate". The same button is offered right after a transcript is saved as notes.
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { errorClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { summariseMeetingAction, type SummariseState } from "./notes-actions";

export function SummariseButton({ meetingId, label, secondary = false }: { meetingId: number; label: string; secondary?: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(summariseMeetingAction.bind(null, meetingId), null as SummariseState);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={pending} className={secondary ? secondaryButtonClass : primaryButtonClass} data-testid="summarise">
        {pending ? "The AI is reading the notes…" : `✦ ${label}`}
      </button>
      {state && !state.ok && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-success">
          Summary ready.
        </p>
      )}
    </form>
  );
}

export type SummaryView = { bullets: string[]; model: string | null; atLabel: string; stale: boolean };

export function SummarySection({
  meetingId,
  summary,
  isAdmin,
  aiReady,
  hasNotes,
}: {
  meetingId: number;
  summary: SummaryView | null;
  isAdmin: boolean;
  aiReady: boolean;
  hasNotes: boolean;
}) {
  return (
    <div id="summary" className="flex scroll-mt-28 flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card" data-testid="meeting-summary">
      <h2 className="font-semibold">Summary</h2>
      {summary ? (
        <>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg" data-testid="summary-bullets">
            {summary.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="text-xs text-subtle">
            Made by AI on {summary.atLabel}
            {isAdmin && summary.model ? ` (${summary.model})` : ""}. It can be wrong: check the notes.
          </p>
          {summary.stale && <p className="rounded-xl bg-warning-bg px-3 py-2 text-xs text-warning">Notes were added after this summary was made.{isAdmin ? " Regenerate it to include them." : ""}</p>}
        </>
      ) : (
        <p className="text-sm text-muted">{hasNotes ? "No summary yet." : "No summary yet: it is made from the meeting's notes or transcript."}</p>
      )}
      {isAdmin &&
        (aiReady ? (
          hasNotes ? (
            <SummariseButton meetingId={meetingId} label={summary ? "Regenerate" : "Summarise"} secondary={!!summary} />
          ) : (
            <p className="text-xs text-subtle">Add notes or save a transcript as notes first.</p>
          )
        ) : (
          <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning">Summaries are off: ANTHROPIC_API_KEY is not set. (Only admins see this.)</p>
        ))}
    </div>
  );
}
