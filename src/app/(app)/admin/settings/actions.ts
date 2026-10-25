"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setAiTasksNeedConfirmation } from "@/lib/settings";

export type SettingsState = { saved?: boolean; message?: string } | null;

/** Admin → Settings: whether AI-created tasks wait for the assignee to confirm them. */
export async function saveAiConfirmationAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requireAdmin();
  const required = formData.get("aiConfirmation") !== "off";
  const { accepted } = await setAiTasksNeedConfirmation(required, admin.id);
  for (const path of ["/admin/settings", "/tasks", "/dashboard", "/projects", "/admin/analytics"]) revalidatePath(path, "layout");
  const message = required
    ? "Saved. New AI-created tasks wait for the assignee to confirm them."
    : `Saved. New AI-created tasks count at once.${accepted ? ` ${accepted} waiting ${accepted === 1 ? "task was" : "tasks were"} accepted.` : ""}`;
  return { saved: true, message };
}
