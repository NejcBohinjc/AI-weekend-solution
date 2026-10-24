import Link from "next/link";
import { AdminBadge } from "@/components/badges";
import { NavLinks, type NavItem } from "@/components/nav-links";
import { APP_NAME } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { logoutAction } from "@/lib/auth/actions";
import { ThemeSwitch } from "@/components/theme-switch";
import { UndoToastProvider } from "@/components/undo-toast";
import { NotificationBell } from "@/components/notification-bell";
import { RecorderProvider } from "@/components/recorder/recorder-provider";
import { RecordingIndicator } from "@/components/recorder/recording-indicator";
import { unreadCount } from "@/lib/notifications";
import { themePref } from "@/lib/theme-server";

const MEMBER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tasks", label: "Tasks" },
  { href: "/hours", label: "Hours" },
  { href: "/meetings", label: "Meetings" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/tasks", label: "Board" },
  { href: "/admin/hours", label: "Hours" },
  { href: "/admin/meetings", label: "Meetings" },
  { href: "/admin/analytics", label: "Analytics" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();

  const page = (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/dashboard" className="whitespace-nowrap text-lg font-bold tracking-tight">
            {APP_NAME}
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {member.isAdmin && (
              <span className="hidden sm:flex">
                <RecordingIndicator />
              </span>
            )}
            <span className="hidden truncate text-sm text-fg-2 sm:inline">{member.name}</span>
            {/* On phones the admin nav row already says ADMIN; the badge would push "Log out" off-screen. */}
            {member.isAdmin && (
              <span className="hidden sm:inline-flex">
                <AdminBadge />
              </span>
            )}
            <NotificationBell unread={await unreadCount(member.id)} />
            <ThemeSwitch initial={await themePref()} />
            <form action={logoutAction}>
              <button type="submit" className="whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium text-subtle hover:bg-surface-3 hover:text-fg">
                Log out
              </button>
            </form>
          </div>
        </div>
        {/* On phones the admin links get their own row so they are never hidden off-screen. */}
        <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-col gap-1 px-4 pb-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1 overflow-x-auto">
            <NavLinks items={MEMBER_NAV} />
          </div>
          {member.isAdmin && (
            <div className="flex items-center gap-1 overflow-x-auto border-t border-line pt-1 sm:ml-2 sm:border-t-0 sm:border-l sm:border-line sm:pt-0 sm:pl-3">
              <span className="shrink-0 pr-1 text-xs font-semibold uppercase tracking-wide text-warning">Admin</span>
              <NavLinks items={ADMIN_NAV} variant="admin" />
            </div>
          )}
        </nav>
        {member.isAdmin && (
          <div className="sm:hidden">
            <RecordingIndicator variant="bar" />
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <UndoToastProvider>{children}</UndoToastProvider>
      </main>
    </div>
  );
  // The meeting recorder lives here so a recording keeps running across pages. Admins only.
  return member.isAdmin ? <RecorderProvider>{page}</RecorderProvider> : page;
}
