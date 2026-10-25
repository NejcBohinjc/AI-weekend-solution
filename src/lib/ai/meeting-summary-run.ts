// "Summarise" for one meeting, against the database: admins only. All the meeting's notes (newest first,
// capped like "Ask about a meeting") go to Claude; the summary is stored on the meeting's newest note (and
// removed from older ones, so a meeting has one summary) with the model and the time. Tested with a mocked
// API call in meeting-summary-run.test.ts.
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { meetingNotes, meetings } from "@/db/schema";
import { ljubljanaParts } from "@/lib/hours/time";
import { joinNotes } from "./meeting-qa";
import { callClaudeSummary, summariseNotes } from "./meeting-summary";
import type { ModelCall } from "./meeting-tasks";

export type StoredSummary = { text: string; model: string | null; at: Date; noteId: number };

/** The meeting's summary (kept on one of its notes) and whether notes were added after it was made. */
export async function summaryOfMeeting(meetingId: number): Promise<(StoredSummary & { stale: boolean }) | null> {
  const notes = await db
    .select({ id: meetingNotes.id, summary: meetingNotes.summary, model: meetingNotes.summaryModel, at: meetingNotes.summaryAt, createdAt: meetingNotes.createdAt })
    .from(meetingNotes)
    .where(eq(meetingNotes.meetingId, meetingId))
    .orderBy(desc(meetingNotes.createdAt), desc(meetingNotes.id));
  return pickSummary(notes);
}

/** Pure part of summaryOfMeeting(): `notes` newest first. */
export function pickSummary(
  notes: { id: number; summary: string | null; model: string | null; at: Date | null; createdAt: Date }[],
): (StoredSummary & { stale: boolean }) | null {
  const holder = notes.find((n) => n.summary && n.at);
  if (!holder) return null;
  const stale = notes.some((n) => n.createdAt.getTime() > holder.at!.getTime());
  return { text: holder.summary!, model: holder.model, at: holder.at!, noteId: holder.id, stale };
}

export type SummariseResult = { ok: true; text: string; at: Date } | { ok: false; error: string };

export async function summariseMeeting({
  meetingId,
  admin,
  call = callClaudeSummary,
  now = new Date(),
}: {
  meetingId: number;
  admin: { id: number; isAdmin: boolean };
  call?: ModelCall;
  now?: Date;
}): Promise<SummariseResult> {
  if (!admin.isAdmin) return { ok: false, error: "Only admins can summarise a meeting." };
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) return { ok: false, error: "Meeting not found." };
  const notes = await db
    .select({ id: meetingNotes.id, content: meetingNotes.content, createdAt: meetingNotes.createdAt })
    .from(meetingNotes)
    .where(eq(meetingNotes.meetingId, meetingId))
    .orderBy(desc(meetingNotes.createdAt), desc(meetingNotes.id));
  if (!notes.length) return { ok: false, error: "This meeting has no notes yet." };

  const { text } = joinNotes(notes.map((n) => ({ content: n.content, addedOn: ljubljanaParts(n.createdAt).date })));
  const result = await summariseNotes({ title: meeting.title, series: meeting.series, date: ljubljanaParts(meeting.startsAt).date }, text, call);
  if (!result.ok) return { ok: false, error: result.error };

  await db.transaction(async (tx) => {
    const holder = notes[0].id; // the newest note
    await tx.update(meetingNotes).set({ summary: null, summaryModel: null, summaryAt: null }).where(and(eq(meetingNotes.meetingId, meetingId), ne(meetingNotes.id, holder)));
    await tx.update(meetingNotes).set({ summary: result.text, summaryModel: result.model, summaryAt: now }).where(eq(meetingNotes.id, holder));
  });
  return { ok: true, text: result.text, at: now };
}
