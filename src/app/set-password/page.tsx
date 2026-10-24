import { APP_NAME } from "@/lib/app";
import { getSetupLinkMember } from "@/lib/auth/setup-links";
import { InvalidLink, SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const member = token ? await getSetupLinkMember(token) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-slate-500">{APP_NAME}</p>
        <h1 className="text-2xl font-bold tracking-tight">Set your password</h1>
        {member && (
          <p className="text-slate-600">
            For <strong>{member.name}</strong> ({member.email}).
          </p>
        )}
      </header>
      {member && token ? <SetPasswordForm token={token} email={member.email} /> : <InvalidLink />}
    </main>
  );
}
