"use client";

import { useActionState } from "react";
import { errorClass, secondaryButtonClass } from "@/components/ui";
import type { SetupLinkState } from "./actions";
import { CopyLink } from "./copy-link";

export function SetupLinkButton({
  action,
  hasPassword,
}: {
  action: (prev: SetupLinkState) => Promise<SetupLinkState>;
  hasPassword: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <button type="submit" disabled={pending} className={secondaryButtonClass}>
          {pending ? "Generating…" : hasPassword ? "Generate reset link" : "Generate setup link"}
        </button>
      </form>
      {state.error && <p className={errorClass}>{state.error}</p>}
      {state.url && state.expiresAt && <CopyLink url={state.url} expiresAt={state.expiresAt} />}
    </div>
  );
}
