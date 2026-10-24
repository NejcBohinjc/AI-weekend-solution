"use client";

import { useState } from "react";
import { LOCATION_LABELS, WORK_LOCATIONS } from "@/lib/hours/constants";

/**
 * Office / Home as two buttons (a radio group, submitted as "location"). `allowUnspecified` keeps an
 * older entry's "unspecified" as a third choice so editing never guesses a location.
 */
export function LocationToggle({ defaultValue, allowUnspecified = false }: { defaultValue: string; allowUnspecified?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const options = allowUnspecified ? [...WORK_LOCATIONS, "unspecified" as const] : WORK_LOCATIONS;
  return (
    <div role="radiogroup" aria-label="Where you work" className="grid grid-flow-col gap-1 rounded-xl bg-surface-3 p-1 text-sm font-medium" data-testid="location">
      {options.map((o) => (
        <label
          key={o}
          className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-fg ${value === o ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          <input type="radio" name="location" value={o} checked={value === o} onChange={() => setValue(o)} className="sr-only" />
          <span aria-hidden>{o === "office" ? "🏢" : o === "home" ? "🏠" : "·"}</span>
          {LOCATION_LABELS[o]}
        </label>
      ))}
    </div>
  );
}
