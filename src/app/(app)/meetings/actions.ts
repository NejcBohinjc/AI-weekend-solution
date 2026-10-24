"use server";

import { and, eq, notExists, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { attendance, meetingInvites, reminderSettings } from "@/db/schema";
import { requireAdmin, requireMember } from "@/lib/auth";
import { REMINDER_OPTIONS, STATE_LABELS, type AttendanceState } from "@/lib/meetings/constants";
import { meetingById } from "@/lib/meetings/queries";
import { memberActions } from "@/lib/meetings/rules";

function refresh(meetingId?: number) {
  revalidatePath("/meetings");
  if (meetingId) revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/dashboard");
  revalidatePath("/admin/meetings");
}

export type AttendanceActionState = { error?: string; done?: string };

const intentSchema = z.enum(["present", "remote", "excused", "clear"]);

/**
 * A member records their own attendance: present or remote while check-in is open, an excuse (with a
 * reason) until a day after the meeting, or "clear" to take back their own answer in those windows.
 */
export async function setMyAttendanceAction(meetingId: number, _prev: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const me = await requireMember();
  const intent = intentSchema.safeParse(formData.get("intent"));
  if (!intent.success) return { error: "Pick what to record." };
  const meeting = await meetingById(meetingId);
  if (!meeting) return { error: "This meeting no longer exists." };
  const [invite] = await db
    .select()
    .from(meetingInvites)
    .where(and(eq(meetingInvites.meetingId, meetingId), eq(meetingInvites.memberId, me.id)))
    .limit(1);
  if (!invite) return { error: "You are not invited to this meeting." };

  const now = new Date();
  const can = memberActions({ ...meeting, cancelled: meeting.status !== "confirmed" }, now);
  const [existing] = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.meetingId, meetingId), eq(attendance.memberId, me.id)))
    .limit(1);
  if (existing?.source === "admin" && !me.isAdmin) return { error: "An admin recorded your attendance. Ask them if it needs changing." };

  if (intent.data === "clear") {
    if (!can.checkIn && !can.excuse) return { error: "This meeting is closed. Ask an admin if something needs changing." };
    await db.delete(attendance).where(and(eq(attendance.meetingId, meetingId), eq(attendance.memberId, me.id)));
    refresh(meetingId);
    return { done: "Your answer was removed." };
  }

  let note: string | null = null;
  if (intent.data === "excused") {
    if (!can.excuse) return { error: "Excuses close a day after the meeting. Ask an admin." };
    note = String(formData.get("note") ?? "").trim();
    if (note.length < 3) return { error: "Write a short reason for the excuse." };
    if (note.length > 500) return { error: "Keep the reason under 500 characters." };
  } else if (!can.checkIn) {
    return { error: "You can check in from 15 minutes before the start until 15 minutes after the end." };
  }

  const state: AttendanceState = intent.data;
  await db
    .insert(attendance)
    .values({ meetingId, memberId: me.id, state, note, source: "self", setById: me.id })
    .onConflictDoUpdate({
      target: [attendance.meetingId, attendance.memberId],
      set: { state, note, source: "self", setById: me.id, updatedAt: new Date() },
    });
  refresh(meetingId);
  return { done: state === "excused" ? "Excuse sent." : `Checked in: ${STATE_LABELS[state].toLowerCase()}.` };
}

// ---------- Admin ----------

const adminStateSchema = z.enum(["present", "remote", "excused", "unexcused", "clear"]);

/** Admins record anyone's attendance for any meeting, at any time. */
export async function adminSetAttendanceAction(meetingId: number, memberId: number, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = adminStateSchema.safeParse(formData.get("state"));
  if (!parsed.success) return;
  if (parsed.data === "clear") {
    await db.delete(attendance).where(and(eq(attendance.meetingId, meetingId), eq(attendance.memberId, memberId)));
  } else {
    const state = parsed.data;
    await db
      .insert(attendance)
      .values({ meetingId, memberId, state, source: "admin", setById: admin.id })
      .onConflictDoUpdate({
        target: [attendance.meetingId, attendance.memberId],
        // An admin changing the state keeps the member's excuse reason only if it stays an excuse.
        set: { state, source: "admin", setById: admin.id, updatedAt: new Date(), note: state === "excused" ? sql`${attendance.note}` : null },
      });
  }
  refresh(meetingId);
}

/** "Everyone else was here": present for every invitee without a record. */
export async function adminMarkRestPresentAction(meetingId: number): Promise<void> {
  const admin = await requireAdmin();
  const missing = await db
    .select({ memberId: meetingInvites.memberId })
    .from(meetingInvites)
    .where(
      and(
        eq(meetingInvites.meetingId, meetingId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(attendance)
            .where(and(eq(attendance.meetingId, meetingId), eq(attendance.memberId, meetingInvites.memberId))),
        ),
      ),
    );
  if (missing.length) {
    await db
      .insert(attendance)
      .values(missing.map((m) => ({ meetingId, memberId: m.memberId, state: "present" as const, source: "admin" as const, setById: admin.id })))
      .onConflictDoNothing();
  }
  refresh(meetingId);
}

// ---------- Reminder settings ----------

export type ReminderSettingsState = { error?: string; saved?: boolean };

export async function saveReminderSettingsAction(_prev: ReminderSettingsState, formData: FormData): Promise<ReminderSettingsState> {
  const me = await requireMember();
  const allowed = new Set(REMINDER_OPTIONS.map((o) => o.minutes));
  const minutesBefore = [...new Set(formData.getAll("minutesBefore").map(Number))].filter((m) => allowed.has(m)).sort((a, b) => b - a);
  const emailEnabled = formData.get("emailEnabled") === "on";
  await db
    .insert(reminderSettings)
    .values({ memberId: me.id, emailEnabled, minutesBefore })
    .onConflictDoUpdate({ target: reminderSettings.memberId, set: { emailEnabled, minutesBefore, updatedAt: new Date() } });
  revalidatePath("/meetings");
  return { saved: true };
}
