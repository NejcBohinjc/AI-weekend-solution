"use server";

import { aiEnabled } from "@/lib/ai/meeting-tasks";
import { askAboutMeeting, type AskResult } from "@/lib/ai/meeting-qa-run";
import { requireMember } from "@/lib/auth";

export type AskState = (AskResult & { question: string; at: number }) | null;

/** "Ask about a meeting". A picked meeting ("pick", from the "which meeting?" choice) wins over the select. */
export async function askAction(_prev: AskState, formData: FormData): Promise<AskState> {
  const me = await requireMember();
  const question = String(formData.get("question") ?? "");
  const at = Date.now();
  if (!aiEnabled()) return { kind: "error", error: "Asking about meetings is not set up.", question, at };
  const id = Number(formData.get("pick") || formData.get("meetingId") || 0);
  const date = String(formData.get("date") ?? "") || null;
  const result = await askAboutMeeting({ member: me, question, meetingId: Number.isInteger(id) && id > 0 ? id : null, date });
  return { ...result, question, at };
}
