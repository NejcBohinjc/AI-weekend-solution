"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { AUTO_CONFIRM_AI_TASKS, setFlag } from "@/lib/settings";

export type SettingsState = { done?: string; error?: string } | null;

/** Turns the "AI tasks need confirming" requirement off or on for the whole institute. */
export async function setAutoConfirmAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const me = await requireAdmin();
  const on = form.get("on") === "true";
  try {
    await setFlag(AUTO_CONFIRM_AI_TASKS, on, me.id);
  } catch {
    return { error: "Could not save the setting. Try again." };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/tasks");
  return { done: on ? "New AI tasks now count straight away." : "New AI tasks now wait to be confirmed." };
}
