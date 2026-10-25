"use client";

import { useActionState, useRef } from "react";
import { inputClass, labelClass, primaryButtonClass, errorClass, secondaryButtonClass } from "@/components/ui";
import { Arrow } from "@/components/ui-kit";
import { loginAction, type LoginState } from "@/lib/auth/actions";

type DemoAccount = { label: string; name: string; email: string };
export type DemoConfig = { password: string; accounts: DemoAccount[] };

export function LoginForm({ demo }: { demo: DemoConfig | null }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function fillDemo(account: DemoAccount) {
    if (!demo || !emailRef.current || !passwordRef.current) return;
    emailRef.current.value = account.email;
    passwordRef.current.value = demo.password;
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Email</span>
          <input
            ref={emailRef}
            name="email"
            type="email"
            autoComplete="username"
            required
            defaultValue={state.email}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Password</span>
          <input ref={passwordRef} name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </label>
        {state.error && (
          <p role="alert" className={errorClass}>
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className={`group ${primaryButtonClass}`}>
          {pending ? "Signing in…" : "Sign in"}
          {!pending && <Arrow />}
        </button>
      </form>

      {demo && (
        <section aria-label="Demo accounts" className="rounded-2xl border border-dashed border-warning-line bg-warning-bg p-4">
          <h2 className="text-sm font-semibold text-warning">Demo accounts</h2>
          <p className="mt-0.5 text-xs text-warning">Sandbox data only. Fills in the form; press Sign in.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {demo.accounts.map((a) => (
              <button key={a.email} type="button" onClick={() => fillDemo(a)} className={secondaryButtonClass}>
                {a.label}: {a.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
