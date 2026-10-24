"use client";

import { useState } from "react";
import { THEME_COOKIE, THEMES, type ThemePref } from "@/lib/theme";

const LABELS: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };

function Icon({ theme }: { theme: ThemePref }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (theme === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (theme === "dark")
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

declare global {
  interface Window {
    __applyTheme?: () => void;
  }
}

/** System / Light / Dark. Saves the choice in a cookie (for a year) and applies it at once. */
export function ThemeSwitch({ initial, showLabels = false }: { initial: ThemePref; showLabels?: boolean }) {
  const [pref, setPref] = useState(initial);

  function choose(next: ThemePref) {
    setPref(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.themePref = next;
    window.__applyTheme?.();
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex shrink-0 items-center rounded-lg bg-surface-3 p-0.5">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={pref === t}
          aria-label={LABELS[t]}
          title={LABELS[t]}
          onClick={() => choose(t)}
          className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition ${pref === t ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          <Icon theme={t} />
          {showLabels && <span>{LABELS[t]}</span>}
        </button>
      ))}
    </div>
  );
}
