"use client";

// The profile menu (top right): notifications, settings, the Admin tools on phones, theme and log out.
// This is where the rarely used things live, so the header stays calm.
import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { ADMIN_GROUPS } from "@/lib/nav";
import type { ThemePref } from "@/lib/theme";
import { menuItemClass, Popover } from "./popover";
import { ThemeSwitch } from "./theme-switch";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function UserMenu({ name, email, isAdmin, unread, theme }: { name: string; email: string; isAdmin: boolean; unread: number; theme: ThemePref }) {
  return (
    <Popover
      label={unread ? `Profile menu, ${unread} unread notifications` : "Profile menu"}
      buttonClassName="relative flex size-10 items-center justify-center rounded-pill bg-surface-3 font-display text-sm font-semibold text-fg transition hover:bg-surface-4"
      panelClassName="w-72"
      trigger={
        <>
          {initials(name)}
          {unread > 0 && <span data-testid="bell" aria-hidden className="absolute right-0 top-0 size-3 rounded-full border-2 border-page bg-danger-solid" />}
        </>
      }
    >
      <div className="px-3 pb-2 pt-1">
        <p className="font-display text-base font-semibold">{name}</p>
        <p className="truncate text-xs text-subtle">{email}</p>
      </div>
      <Link href="/notifications" role="menuitem" className={menuItemClass}>
        Notifications
        {unread > 0 && <span className="rounded-pill bg-danger-solid px-2 py-0.5 text-xs font-bold text-on-primary">{unread > 99 ? "99+" : unread}</span>}
      </Link>
      <Link href="/settings" role="menuitem" className={menuItemClass}>
        Settings and reminders
      </Link>
      {isAdmin && (
        <div className="mt-1 border-t border-line pt-1 md:hidden">
          {ADMIN_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="px-3 pb-1 pt-2 font-display text-[11px] font-semibold uppercase tracking-eyebrow text-brand">Admin · {g.title}</p>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} role="menuitem" className={menuItemClass}>
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-line px-3 py-3">
        <span className="text-sm font-medium text-fg-2">Theme</span>
        <ThemeSwitch initial={theme} />
      </div>
      <form action={logoutAction} className="border-t border-line pt-1">
        <button type="submit" className={`${menuItemClass} text-danger hover:text-danger`}>
          Log out
        </button>
      </form>
    </Popover>
  );
}

export function AdminMenu() {
  return (
    <Popover
      label="Admin tools"
      align="left"
      buttonClassName="rounded-pill px-4 py-2 font-display text-sm font-semibold text-muted transition hover:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg"
      panelClassName="w-64"
      trigger={
        <span className="flex items-center gap-1.5">
          Admin
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      }
    >
      {ADMIN_GROUPS.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 pt-2 font-display text-[11px] font-semibold uppercase tracking-eyebrow text-brand">{g.title}</p>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} role="menuitem" className={menuItemClass}>
              {i.label}
            </Link>
          ))}
        </div>
      ))}
    </Popover>
  );
}
