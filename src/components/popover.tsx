"use client";

// A small dropdown: a button that opens a panel. Closes on outside click, Escape and when a link inside is
// followed. Used for the profile menu, the Admin menu and the "⋯" menu of rows.
import { useEffect, useRef, useState } from "react";

export function Popover({
  trigger,
  label,
  align = "right",
  buttonClassName = "",
  panelClassName = "",
  children,
}: {
  trigger: React.ReactNode;
  label: string;
  align?: "left" | "right";
  buttonClassName?: string;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={buttonClassName}>
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
          className={`absolute top-full z-30 mt-2 min-w-56 rounded-card border border-line bg-surface p-2 shadow-pop ${align === "right" ? "right-0" : "left-0"} ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const menuItemClass = "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg";

/** The "⋯" menu for the secondary actions of a row or card. */
export function ActionMenu({ label = "More actions", children }: { label?: string; children: React.ReactNode }) {
  return (
    <Popover
      label={label}
      trigger={<span aria-hidden className="text-xl leading-none">⋯</span>}
      buttonClassName="flex size-9 items-center justify-center rounded-pill text-muted transition hover:bg-surface-3 hover:text-fg"
    >
      {children}
    </Popover>
  );
}
