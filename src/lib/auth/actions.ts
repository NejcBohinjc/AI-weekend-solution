"use server";

import { redirect } from "next/navigation";
import { signInAsMember, signOut } from ".";

export async function loginAction(formData: FormData) {
  const memberId = Number(formData.get("memberId"));
  if (!Number.isInteger(memberId) || !(await signInAsMember(memberId))) {
    redirect("/login?error=unknown");
  }
  redirect("/dashboard");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}
