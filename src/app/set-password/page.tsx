import { ThemeSwitch } from "@/components/theme-switch";
import { themePref } from "@/lib/theme-server";
import { cardClass } from "@/components/ui";
import { PageTitle } from "@/components/ui-kit";
import { APP_NAME } from "@/lib/app";
import { getSetupLinkMember } from "@/lib/auth/setup-links";
import { InvalidLink, SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const member = token ? await getSetupLinkMember(token) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-10 px-5 py-12">
      <header className="flex flex-col gap-5">
        <p className="font-display text-lg font-semibold tracking-display">{APP_NAME}</p>
        <PageTitle
          accent="password"
          sub={
            member ? (
              <>
                For <strong>{member.name}</strong> ({member.email}).
              </>
            ) : undefined
          }
        >
          Set your
        </PageTitle>
      </header>
      <div className={cardClass}>{member && token ? <SetPasswordForm token={token} email={member.email} /> : <InvalidLink />}</div>
      <div className="flex justify-end">
        <ThemeSwitch initial={await themePref()} />
      </div>
    </main>
  );
}
