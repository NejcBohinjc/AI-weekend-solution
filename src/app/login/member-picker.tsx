"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { AdminBadge, TierBadge } from "@/components/badges";
import { loginAction } from "@/lib/auth/actions";

type LoginMember = { id: number; name: string; tier: string; isAdmin: boolean };

// Strip diacritics so "ziga" finds "Žiga".
const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function MemberPicker({ members, currentId }: { members: LoginMember[]; currentId?: number }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return members;
    return members.filter((m) => normalize(`${m.name} ${m.tier} ${m.isAdmin ? "admin" : ""}`).includes(q));
  }, [members, query]);

  return (
    <form action={loginAction} className="flex flex-col gap-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, tier or “admin”"
        aria-label="Search members"
        autoFocus
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
      />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {visible.map((m) => (
          <li key={m.id}>
            <MemberButton member={m} current={m.id === currentId} />
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No one matches “{query}”.</li>}
      </ul>
    </form>
  );
}

function MemberButton({ member, current }: { member: LoginMember; current: boolean }) {
  const { pending, data } = useFormStatus();
  const isThis = pending && data?.get("memberId") === String(member.id);
  return (
    <button
      type="submit"
      name="memberId"
      value={member.id}
      disabled={pending}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none disabled:opacity-60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
        {member.name
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)}
      </span>
      <span className="flex-1 truncate font-medium">{member.name}</span>
      {current && <span className="text-xs text-slate-500">current</span>}
      {member.isAdmin && <AdminBadge />}
      <TierBadge tier={member.tier} />
      {isThis && <span className="text-xs text-slate-500">Signing in…</span>}
    </button>
  );
}
