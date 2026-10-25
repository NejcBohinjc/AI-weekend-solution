"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";
import type { AskState } from "./actions";

type MeetingOption = { id: number; title: string; series: string; startsAt: string };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TIMEZONE });

export function AskForm({
  action,
  meetings,
  initialMeetingId,
  maxQuestion,
  notesCap,
}: {
  action: (prev: AskState, formData: FormData) => Promise<AskState>;
  meetings: MeetingOption[];
  initialMeetingId: number | null;
  maxQuestion: number;
  notesCap: number;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [meetingId, setMeetingId] = useState(initialMeetingId ? String(initialMeetingId) : "");

  return (
    <div className="flex flex-col gap-4">
      {/* Submitted by hand (not action=) so React does not reset the form after each answer: the
          question and the picked meeting stay for a follow-up. The submitter carries "pick". */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => formAction(data));
        }}
        className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card"
        data-testid="ask-form"
      >
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Meeting</span>
          <select name="meetingId" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={inputClass}>
            <option value="">Find it by date</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} · {when(m.startsAt)}
              </option>
            ))}
          </select>
        </label>
        {!meetingId && (
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Date (optional if the question names it)</span>
            <input name="date" type="date" className={inputClass} />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Your question</span>
          <textarea
            name="question"
            rows={3}
            required
            maxLength={maxQuestion}
            defaultValue={state?.question}
            className={inputClass}
            placeholder={meetingId ? "What did we decide about the budget?" : "What was discussed on 14 October?"}
          />
        </label>
        {state?.kind === "error" && (
          <p role="alert" className={errorClass}>
            {state.error}
          </p>
        )}
        {state?.kind === "choose" && (
          <div role="status" className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-sm" data-testid="ask-choose">
            <p className="font-medium">You had several meetings with notes that day. Which one?</p>
            <div className="flex flex-wrap gap-2">
              {state.meetings.map((m) => (
                <button key={m.id} type="submit" name="pick" value={m.id} disabled={pending} className={secondaryButtonClass}>
                  {m.title} · {new Date(m.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE })}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="submit" disabled={pending} className={`${primaryButtonClass} self-start`}>
          {pending ? "Reading the notes…" : "✦ Ask"}
        </button>
        <p className="text-xs text-subtle">
          The answer comes only from the stored notes of the meeting (AI, Claude). Check the quoted lines; the AI can be wrong.
        </p>
      </form>

      {state?.kind === "answer" && (
        <article key={state.at} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card" data-testid="ask-answer" aria-live="polite">
          <p className="text-xs text-subtle">
            Based on the notes of{" "}
            <Link href={`/meetings/${state.meeting.id}`} className="font-medium text-fg-2 underline-offset-2 hover:underline">
              {state.meeting.title}
            </Link>{" "}
            · {when(new Date(state.meeting.startsAt).toISOString())}
          </p>
          <p className={`whitespace-pre-wrap text-sm ${state.found ? "text-fg" : "text-muted"}`} data-testid="ask-answer-text">
            {state.answer}
          </p>
          {state.quotes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">From the notes</h2>
              {state.quotes.map((q) => (
                <blockquote key={q} className="border-l-2 border-line-strong pl-3 text-sm text-fg-2" data-testid="ask-quote">
                  {q}
                </blockquote>
              ))}
            </div>
          )}
          {state.truncated && (
            <p className="text-xs text-warning">These notes are long: only the newest {notesCap.toLocaleString("en-GB")} characters were read.</p>
          )}
        </article>
      )}
    </div>
  );
}
