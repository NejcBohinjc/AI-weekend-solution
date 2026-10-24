import Link from "next/link";
import { getSession, listLoginMembers } from "@/lib/auth";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { MemberPicker } from "./member-picker";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [members, session, { error }] = await Promise.all([listLoginMembers(), getSession(), searchParams]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="text-slate-600">{APP_TAGLINE}</p>
      </header>

      {session ? (
        <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3 text-sm">
          <span>
            Signed in as <strong>{session.name}</strong>. Pick someone else to switch.
          </span>
          <Link href="/dashboard" className="font-medium text-slate-900 underline underline-offset-2">
            Back
          </Link>
        </div>
      ) : (
        <p className="text-sm text-slate-600">Who are you? Pick your name to sign in.</p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          That member could not be found. Please pick again.
        </p>
      )}

      <MemberPicker members={members} currentId={session?.memberId} />
    </main>
  );
}
