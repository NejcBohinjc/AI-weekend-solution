import Link from "next/link";
import { BottomTabs, NavLinks } from "@/components/nav-links";
import { UserMenu, AdminMenu } from "@/components/user-menu";
import { UndoToastProvider } from "@/components/undo-toast";
import { RecorderProvider } from "@/components/recorder/recorder-provider";
import { RecordingIndicator } from "@/components/recorder/recording-indicator";
import { MEMBER_NAV } from "@/lib/nav";
import { requireSession } from "@/lib/auth";
import { themePref } from "@/lib/theme-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { member, unread } = await requireSession();

  const page = (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-page/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="whitespace-nowrap font-display text-xl font-semibold tracking-display">
            Shapers <em className="pr-[0.08em] font-serif font-normal italic text-brand">Hub</em>
          </Link>
          <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
            <NavLinks items={MEMBER_NAV} />
            {member.isAdmin && <AdminMenu />}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {member.isAdmin && (
              <span className="hidden sm:flex">
                <RecordingIndicator />
              </span>
            )}
            <UserMenu name={member.name} email={member.email} isAdmin={member.isAdmin} unread={unread} theme={await themePref()} />
          </div>
        </div>
        {member.isAdmin && (
          <div className="sm:hidden">
            <RecordingIndicator variant="bar" />
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-8 sm:px-6 md:pb-12 md:pt-10">
        <UndoToastProvider>{children}</UndoToastProvider>
      </main>
      <BottomTabs items={MEMBER_NAV} />
    </div>
  );
  // The meeting recorder lives here so a recording keeps running across pages. Admins only.
  return member.isAdmin ? <RecorderProvider>{page}</RecorderProvider> : page;
}
