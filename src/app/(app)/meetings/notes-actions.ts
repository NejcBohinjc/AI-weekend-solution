"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/db";
import { meetingNotes } from "@/db/schema";
import { aiEnabled, cleanNotes, NOTES_MAX_CHARS } from "@/lib/ai/meeting-tasks";
import { canUseMeetingNotes, createTasksFromNote, hashNotes, type AiRunResult } from "@/lib/ai/meeting-tasks-run";
import { summariseMeeting } from "@/lib/ai/meeting-summary-run";
import { requireAdmin, requireMember } from "@/lib/auth";
import { runTasksSync } from "@/lib/tasks/sheet-sync";

const FILE_TYPES = /\.(txt|md|vtt|srt)$/i;
const MAX_FILE_BYTES = 1_000_000;

export type NoteFormState = { error?: string; saved?: boolean; text?: string };

/** Adds pasted notes or an uploaded transcript (.txt, .md, .vtt, .srt) to a meeting. */
export async function addNoteAction(meetingId: number, _prev: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const me = await requireMember();
  if (!(await canUseMeetingNotes(me, meetingId))) return { error: "Only this meeting's attendees and admins can add notes." };
  const pasted = String(formData.get("notes") ?? "");
  const file = formData.get("file");
  let text = pasted;
  let fileName: string | null = null;
  // A Blob with a name (the File class is not a global on Node 18).
  if (file instanceof Blob && file.size > 0) {
    const name = (file as Blob & { name?: string }).name ?? "";
    if (!FILE_TYPES.test(name)) return { error: "Upload a .txt, .md, .vtt or .srt file (no audio).", text: pasted };
    if (file.size > MAX_FILE_BYTES) return { error: "That file is too large (max 1 MB).", text: pasted };
    fileName = name;
    text = await file.text();
  }
  const content = cleanNotes(text, fileName);
  if (!content) return { error: "Paste some notes or choose a file.", text: pasted };
  if (content.length > NOTES_MAX_CHARS) {
    return {
      error: `Notes can be at most ${NOTES_MAX_CHARS.toLocaleString("en-GB")} characters; these have ${content.length.toLocaleString("en-GB")}. Split them or shorten them.`,
      text: pasted,
    };
  }
  await db.insert(meetingNotes).values({ meetingId, authorId: me.id, content, contentHash: hashNotes(content), fileName });
  revalidatePath(`/meetings/${meetingId}`);
  return { saved: true };
}

export type AiRunState = (AiRunResult & { at: number }) | null;

/** "Create tasks from notes". Tasks then go to the Google Sheet like any other task. */
export async function createTasksFromNotesAction(noteId: number, meetingId: number, _prev: AiRunState): Promise<AiRunState> {
  const me = await requireMember();
  const at = Date.now();
  if (!aiEnabled()) return { ok: false, error: "AI task creation is not set up.", created: [], skipped: 0, discarded: 0, reused: false, at };
  const result = await createTasksFromNote({ noteId, member: me });
  if (result.created.length) {
    after(async () => {
      try {
        await runTasksSync({ actorId: me.id, minIntervalSeconds: 0 });
      } catch (err) {
        console.error("[tasks sheet]", (err as Error).message);
      }
    });
  }
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ...result, at };
}

export type SummariseState = { ok: boolean; error?: string; at: number } | null;

/** Admin: "Summarise" / "Regenerate" (also offered right after a transcript is saved as notes). */
export async function summariseMeetingAction(meetingId: number, _prev: SummariseState): Promise<SummariseState> {
  const admin = await requireAdmin();
  const at = Date.now();
  if (!aiEnabled()) return { ok: false, error: "Summaries are off: ANTHROPIC_API_KEY is not set.", at };
  const result = await summariseMeeting({ meetingId, admin });
  if (result.ok) revalidatePath(`/meetings/${meetingId}`);
  return result.ok ? { ok: true, at } : { ok: false, error: result.error, at };
}
