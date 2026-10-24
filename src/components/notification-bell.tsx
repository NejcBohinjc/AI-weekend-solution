import Link from "next/link";

/** Header bell with the member's unread count (server-rendered, refreshed on every page load). */
export function NotificationBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      title="Notifications"
      className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg"
      data-testid="bell"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger-solid px-1 text-[10px] font-bold leading-4 text-on-primary">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
