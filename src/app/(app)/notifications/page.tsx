import { revalidatePath } from "next/cache";
import { secondaryButtonClass } from "@/components/ui";
import { TIMEZONE } from "@/lib/app";
import { requireMember } from "@/lib/auth";
import { listNotifications, markAllRead } from "@/lib/notifications";

export const dynamic = "force-dynamic";

async function markAllReadAction() {
  "use server";
  const me = await requireMember();
  await markAllRead(me.id);
  revalidatePath("/", "layout");
}

/** The member's own notifications (never anyone else's). */
export default async function NotificationsPage() {
  const me = await requireMember();
  const items = await listNotifications(me.id);
  const unread = items.filter((n) => !n.readAt).length;
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TIMEZONE });
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-display">Notifications</h1>
          <p className="text-sm text-muted">{unread ? `${unread} unread` : "All read"}</p>
        </div>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button type="submit" className={secondaryButtonClass}>
              Mark all as read
            </button>
          </form>
        )}
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-sm text-subtle">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card" data-testid="notifications">
          {items.map((n) => (
            <li key={n.id}>
              <a href={`/notifications/${n.id}`} className={`flex gap-3 px-4 py-3 hover:bg-surface-2 ${n.readAt ? "" : "bg-accent-bg"}`}>
                {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                <span className="flex flex-col">
                  <span className={n.readAt ? "text-fg-2" : "font-medium text-fg"}>{n.text}</span>
                  <span className="text-xs text-subtle">{fmt(n.createdAt)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
