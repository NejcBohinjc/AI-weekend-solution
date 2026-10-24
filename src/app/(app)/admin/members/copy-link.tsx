"use client";

import { useState } from "react";
import { inputClass, secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";

export function CopyLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  const expires = new Date(expiresAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          aria-label="Setup link"
          onFocus={(e) => e.currentTarget.select()}
          className={`${inputClass} min-w-0 font-mono text-xs`}
          data-testid="setup-link"
        />
        <button type="button" onClick={copy} className={`${secondaryButtonClass} shrink-0`}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Shown only once. Works once, until {expires}. Generating a new link cancels this one.
      </p>
    </div>
  );
}
