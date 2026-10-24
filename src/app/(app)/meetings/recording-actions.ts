"use server";

// Recording uploads in three steps, so large files never pass through the app:
// 1. startRecordingUploadAction checks who may store what, creates the row and returns an upload URL;
// 2. the browser PUTs the file to that URL (storage directly, or /api/recordings/<id>/upload locally);
// 3. finishRecordingUploadAction checks the file arrived whole and marks the recording ready.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { meetingInvites, meetingRecordings } from "@/db/schema";
import { requireAdmin, requireMember } from "@/lib/auth";
import { RECORDING_SOURCES } from "@/lib/meetings/constants";
import { meetingById } from "@/lib/meetings/queries";
import { canUploadRecording, extensionFor, recordedUploadOpen, recordingFileProblem } from "@/lib/meetings/recordings";
import { deleteStored, storageMode, storedSize, uploadUrl } from "@/lib/storage";

export type StartUploadResult = { error: string } | { recordingId: number; url: string; contentType: string };

const inputSchema = z.object({
  source: z.enum(RECORDING_SOURCES),
  fileName: z.string().max(200).nullable(),
  contentType: z.string().min(1).max(100),
  size: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().max(24 * 3600).nullable(),
});

function refresh(meetingId: number) {
  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/admin/meetings");
}

export async function startRecordingUploadAction(meetingId: number, input: z.input<typeof inputSchema>): Promise<StartUploadResult> {
  const me = await requireMember();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "That file cannot be stored." };
  const { source, fileName, size, durationSeconds } = parsed.data;
  const contentType = parsed.data.contentType.trim();

  const meeting = await meetingById(meetingId);
  if (!meeting) return { error: "This meeting no longer exists." };
  const times = { ...meeting, cancelled: meeting.status !== "confirmed" };
  const now = new Date();

  if (source === "recorded") {
    const [invite] = await db
      .select({ id: meetingInvites.memberId })
      .from(meetingInvites)
      .where(and(eq(meetingInvites.meetingId, meetingId), eq(meetingInvites.memberId, me.id)))
      .limit(1);
    if (!invite && !me.isAdmin) return { error: "Only people invited to this meeting can record it." };
    if (!recordedUploadOpen(times, now)) return { error: "It is too long after the meeting to save a room recording. Download it and ask an admin to upload it." };
  } else {
    if (!me.isAdmin) return { error: "Only admins upload recordings." };
    const [ready] = await db
      .select({ id: meetingRecordings.id })
      .from(meetingRecordings)
      .where(and(eq(meetingRecordings.meetingId, meetingId), eq(meetingRecordings.status, "ready")))
      .limit(1);
    if (!canUploadRecording(times, !!ready, now)) {
      return { error: ready ? "This meeting already has a recording. Delete it first to replace it." : "Recordings can be uploaded once the meeting is over." };
    }
  }

  const problem = recordingFileProblem({ contentType, size });
  if (problem) return { error: problem };
  if (storageMode() === "none") return { error: "Recording storage is not set up yet, so the file cannot be saved here. Keep the file and upload it later." };

  const storageKey = `meetings/${meetingId}/${randomUUID()}.${extensionFor(contentType, fileName)}`;
  const [row] = await db
    .insert(meetingRecordings)
    .values({
      meetingId,
      uploadedById: me.id,
      source,
      storageKey,
      fileName: fileName?.trim() || null,
      contentType,
      sizeBytes: size,
      durationSeconds: durationSeconds === null ? null : Math.round(durationSeconds),
    })
    .returning({ id: meetingRecordings.id });
  const url = await uploadUrl(storageKey, contentType, `/api/recordings/${row.id}/upload`);
  return { recordingId: row.id, url, contentType };
}

export async function finishRecordingUploadAction(recordingId: number): Promise<{ error?: string }> {
  const me = await requireMember();
  const [row] = await db
    .select()
    .from(meetingRecordings)
    .where(and(eq(meetingRecordings.id, recordingId), eq(meetingRecordings.uploadedById, me.id), eq(meetingRecordings.status, "uploading")))
    .limit(1);
  if (!row) return { error: "This upload is not waiting to be finished." };
  const size = await storedSize(row.storageKey);
  if (size === null) return { error: "The file did not arrive in storage. Try again." };
  if (size !== row.sizeBytes) return { error: "Only part of the file arrived. Try again." };
  await db.update(meetingRecordings).set({ status: "ready", readyAt: new Date() }).where(eq(meetingRecordings.id, row.id));
  refresh(row.meetingId);
  return {};
}

/** Admins delete a recording (also an upload that never finished); the file is removed from storage. */
export async function deleteRecordingAction(recordingId: number): Promise<void> {
  await requireAdmin();
  const [row] = await db.select().from(meetingRecordings).where(eq(meetingRecordings.id, recordingId)).limit(1);
  if (!row) return;
  await deleteStored(row.storageKey);
  await db.delete(meetingRecordings).where(eq(meetingRecordings.id, row.id));
  refresh(row.meetingId);
}
