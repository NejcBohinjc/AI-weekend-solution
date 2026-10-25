// "Create tasks from notes": runs the extraction for one note and creates the tasks. Idempotent:
// identical notes reuse the items of the earlier run (no second API call), and every created item is
// recorded per meeting (ai_task_items), so a rerun never duplicates a task or recreates a deleted one.
import { createHash } from "node:crypto";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { aiTaskItems, aiTaskRuns, meetingInvites, meetingNotes, meetings, members, taskEvents, tasks } from "@/db/schema";
import { ljubljanaParts } from "@/lib/hours/time";
import { AUTO_CONFIRM_AI_TASKS, getFlag } from "@/lib/settings";
import { AI_RUNS_PER_HOUR, callClaude, extractActionItems, itemKey, type ActionItem, type ModelCall } from "./meeting-tasks";

export function hashNotes(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Invitees of the meeting and admins may read and add its notes. */
export async function canUseMeetingNotes(member: { id: number; isAdmin: boolean }, meetingId: number): Promise<boolean> {
  if (member.isAdmin) return true;
  const [row] = await db
    .select({ id: meetingInvites.memberId })
    .from(meetingInvites)
    .where(and(eq(meetingInvites.meetingId, meetingId), eq(meetingInvites.memberId, member.id)))
    .limit(1);
  return !!row;
}

export type AiRunResult = {
  ok: boolean;
  error?: string;
  created: { id: number; title: string }[];
  skipped: number;
  discarded: number;
  reused: boolean;
};

export async function createTasksFromNote({
  noteId,
  member,
  call = callClaude,
  now = new Date(),
}: {
  noteId: number;
  member: { id: number; isAdmin: boolean };
  call?: ModelCall;
  now?: Date;
}): Promise<AiRunResult> {
  const fail = (error: string): AiRunResult => ({ ok: false, error, created: [], skipped: 0, discarded: 0, reused: false });
  const [note] = await db.select().from(meetingNotes).where(eq(meetingNotes.id, noteId)).limit(1);
  if (!note || !(await canUseMeetingNotes(member, note.meetingId))) return fail("Notes not found.");
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, note.meetingId)).limit(1);
  if (!meeting) return fail("Meeting not found.");

  // Same notes as an earlier successful run: reuse its items.
  const [earlier] = await db
    .select()
    .from(aiTaskRuns)
    .where(and(eq(aiTaskRuns.meetingId, meeting.id), eq(aiTaskRuns.notesHash, note.contentHash), eq(aiTaskRuns.ok, true)))
    .orderBy(desc(aiTaskRuns.id))
    .limit(1);

  let items: ActionItem[];
  let discarded = 0;
  let usage: { model: string | null; inputTokens?: number; outputTokens?: number } = { model: earlier?.model ?? null };
  if (earlier) {
    items = earlier.items as ActionItem[];
  } else {
    const [{ n }] = await db
      .select({ n: count() })
      .from(aiTaskRuns)
      .where(and(eq(aiTaskRuns.triggeredById, member.id), eq(aiTaskRuns.calledApi, true), gt(aiTaskRuns.createdAt, new Date(now.getTime() - 3_600_000))));
    if (n >= AI_RUNS_PER_HOUR) return fail(`You can run this ${AI_RUNS_PER_HOUR} times an hour. Please try again later.`);

    const attendees = await db
      .select({ id: members.id, name: members.name, email: members.email })
      .from(meetingInvites)
      .innerJoin(members, eq(meetingInvites.memberId, members.id))
      .where(and(eq(meetingInvites.meetingId, meeting.id), eq(members.active, true)));
    const result = await extractActionItems({ title: meeting.title, date: ljubljanaParts(meeting.startsAt).date, attendees }, note.content, call);
    if (!result.ok) {
      await db.insert(aiTaskRuns).values({
        meetingId: meeting.id,
        noteId: note.id,
        notesHash: note.contentHash,
        triggeredById: member.id,
        model: result.model,
        calledApi: true,
        ok: false,
        error: result.error,
      });
      return fail(result.error);
    }
    items = result.items;
    discarded = result.discarded;
    usage = { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  }

  const created: { id: number; title: string }[] = [];
  let skipped = 0;
  // Read the switch before the transaction: it decides whether these tasks still need a tap to confirm.
  const autoConfirm = await getFlag(AUTO_CONFIRM_AI_TASKS);
  await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(aiTaskRuns)
      .values({
        meetingId: meeting.id,
        noteId: note.id,
        notesHash: note.contentHash,
        triggeredById: member.id,
        model: usage.model,
        calledApi: !earlier,
        ok: true,
        items,
        discarded,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
      .returning({ id: aiTaskRuns.id });
    for (const item of items) {
      // Already created for this meeting (or created and then deleted): skip.
      const [slot] = await tx
        .insert(aiTaskItems)
        .values({ meetingId: meeting.id, itemKey: itemKey(item), runId: run.id })
        .onConflictDoNothing()
        .returning({ id: aiTaskItems.id });
      if (!slot) {
        skipped++;
        continue;
      }
      const [task] = await tx
        .insert(tasks)
        .values({
          title: item.title,
          status: "todo",
          assigneeId: item.assigneeId,
          type: item.type,
          dueDate: item.dueDate,
          source: "app",
          createdByAi: true,
          sourceMeetingId: meeting.id,
          sourceQuote: item.quote,
          aiModel: usage.model,
          triggeredById: member.id,
          // With the switch on, the task counts from the start; with it off, its assignee confirms it.
          aiConfirmedAt: autoConfirm ? new Date() : null,
        })
        .returning({ id: tasks.id, title: tasks.title });
      await tx.update(aiTaskItems).set({ taskId: task.id }).where(eq(aiTaskItems.id, slot.id));
      await tx.insert(taskEvents).values({
        taskId: task.id,
        actorId: member.id,
        source: "ai",
        kind: "created",
        newValue: `Created by AI from the notes of “${meeting.title}”`,
      });
      created.push(task);
    }
    await tx.update(aiTaskRuns).set({ created: created.length, skipped }).where(eq(aiTaskRuns.id, run.id));
  });
  return { ok: true, created, skipped, discarded, reused: !!earlier };
}
