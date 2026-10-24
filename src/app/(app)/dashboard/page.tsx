import { TierBadge } from "@/components/badges";
import { TIMEZONE } from "@/lib/app";
import { getCurrentMember } from "@/lib/auth";

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TIMEZONE }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const [member, { denied }] = await Promise.all([getCurrentMember(), searchParams]);
  const firstName = member.name.split(" ")[0];

  return (
    <section className="flex flex-col gap-4">
      {denied === "admin" && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The admin section is only for admins. You are signed in as <strong>{member.name}</strong>, who is a member.
          Use <strong>Switch user</strong> to sign in as an admin.
        </p>
      )}
      <h1 className="text-2xl font-bold tracking-tight">
        {greeting(new Date())}, {firstName}.
      </h1>
      <p className="flex flex-wrap items-center gap-2 text-slate-600">
        <TierBadge tier={member.tier} />
        <span>Your weekly commitment is {member.weeklyHours} hours.</span>
      </p>
    </section>
  );
}
