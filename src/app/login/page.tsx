import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { members } from "@/db/schema";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { demoPassword } from "@/lib/env";
import { LoginForm, type DemoConfig } from "./login-form";

export const dynamic = "force-dynamic";

async function loadDemoConfig(): Promise<DemoConfig | null> {
  const password = demoPassword();
  if (!password) return null;
  const candidates = await db
    .select({ name: members.name, email: members.email, isAdmin: members.isAdmin })
    .from(members)
    .where(and(eq(members.active, true), isNotNull(members.passwordHash)))
    .orderBy(asc(members.name));
  const admin = candidates.find((m) => m.isAdmin);
  const member = candidates.find((m) => !m.isAdmin);
  const accounts = [
    admin && { label: "Admin", name: admin.name, email: admin.email },
    member && { label: "Member", name: member.name, email: member.email },
  ].filter((a) => !!a);
  return accounts.length ? { password, accounts } : null;
}

export default async function LoginPage() {
  const demo = await loadDemoConfig();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="text-muted">{APP_TAGLINE}</p>
      </header>
      <LoginForm demo={demo} />
      <p className="text-xs text-subtle">No password yet, or forgot it? Ask an admin for a setup link.</p>
    </main>
  );
}
