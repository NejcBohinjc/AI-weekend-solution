"use server";

import { redirect } from "next/navigation";
import { signInWithPassword, signOut, startSession } from ".";
import { checkPasswordRules } from "./password";
import { setPasswordWithLink } from "./setup-links";

export type LoginState = { error?: string; email?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await signInWithPassword(email, password);
  if (result === "rate_limited") {
    return { email, error: "Too many failed attempts. Please wait 15 minutes and try again." };
  }
  if (result === "invalid") return { email, error: "Invalid email or password" };
  redirect("/dashboard");
}

export async function logoutAction() {
  await signOut();
  redirect("/login");
}

export type SetPasswordState = { error?: string; linkInvalid?: boolean };

export async function setPasswordAction(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const ruleError = checkPasswordRules(password);
  if (ruleError) return { error: ruleError };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const memberId = await setPasswordWithLink(token, password);
  if (!memberId) return { linkInvalid: true };

  await startSession(memberId);
  redirect("/dashboard");
}
