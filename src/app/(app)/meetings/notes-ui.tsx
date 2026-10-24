"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";
import type { AiRunState, NoteFormState } from "./notes-actions";

const MAX = 100_000;

export function AddNotesForm({ action }: { action: (prev: NoteFormState, formData: FormData) => Promise<NoteFormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [length, setLength] = useState(0);
  const tooLong = length > MAX;
  return (
    <form key={state.saved ? "saved" : "form"} action={formAction} className="flex flex-col gap-3" data-testid="add-notes">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Paste notes or a transcript</span>
        <textarea
          name="notes"
          rows={6}
          defaultValue={state.text}
          onChange={(e) => setLength(e.target.value.length)}
          className={`${inputClass} font-mono text-sm`}
          placeholder="Who does what by when…"
        />
        <span className={`text-xs ${tooLong ? "font-semibold text-danger" : "text-subtle"}`}>
          {length.toLocaleString("en-GB")} / {MAX.toLocaleString("en-GB")} characters{tooLong && " – too long, please shorten"}
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>…or upload a file (.txt, .md, .vtt, .srt)</span>
        <input name="file" type="file" accept=".txt,.md,.vtt,.srt,text/plain,text/markdown,text/vtt" className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg" />
      </label>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm text-success">
          Notes saved.
        </p>
      )}
      <button type="submit" disabled={pending || tooLong} className={`${primaryButtonClass} self-start`}>
        {pending ? "Saving…" : "Add meeting notes"}
      </button>
    </form>
  );
}

export function CreateTasksButton({ action }: { action: (prev: AiRunState) => Promise<AiRunState> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "The AI is reading the notes…" : "✦ Create tasks from notes"}
        </button>
      </form>
      {state && !state.ok && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div role="status" className="rounded-xl bg-violet-bg px-4 py-3 text-sm text-fg-2" data-testid="ai-result">
          <p className="font-semibold text-violet">
            {state.created.length
              ? `Created ${state.created.length} ${state.created.length === 1 ? "task" : "tasks"} (marked AI, waiting for review):`
              : "No new tasks."}
          </p>
          {state.created.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.created.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="text-link underline underline-offset-2">
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {(state.skipped > 0 || state.discarded > 0 || state.reused) && (
            <p className="mt-1 text-xs text-muted">
              {state.skipped > 0 && `${state.skipped} already created from this meeting earlier (or deleted), skipped. `}
              {state.discarded > 0 && `${state.discarded} unusable ${state.discarded === 1 ? "item" : "items"} dropped. `}
              {state.reused && "Same notes as before: the earlier result was reused, the AI was not asked again."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** "Add meeting notes", open at first when there are no notes; stays as the member left it after saving. */
export function AddNotesSection({ action, initiallyOpen }: { action: (prev: NoteFormState, formData: FormData) => Promise<NoteFormState>; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Add meeting notes</summary>
      <div className="mt-3">
        <AddNotesForm action={action} />
      </div>
    </details>
  );
}
