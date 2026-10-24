"use client";

import Link from "next/link";
import { useActionState } from "react";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { setPasswordAction, type SetPasswordState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(setPasswordAction, {});

  if (state.linkInvalid) return <InvalidLink />;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          className={inputClass}
        />
        <span className="text-xs text-subtle">At least {PASSWORD_MIN_LENGTH} characters. A short sentence works well.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Repeat password</span>
        <input name="confirm" type="password" autoComplete="new-password" required className={inputClass} />
      </label>
      {state.error && (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving…" : "Set password and sign in"}
      </button>
    </form>
  );
}

export function InvalidLink() {
  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className={errorClass}>
        This link is invalid, has expired or has already been used. Ask an admin for a new one.
      </p>
      <Link href="/login" className="text-sm font-medium text-fg underline underline-offset-2">
        Go to sign in
      </Link>
    </div>
  );
}
