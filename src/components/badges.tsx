const TIER_STYLES: Record<string, string> = {
  Core: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Impact: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "GO!": "bg-sky-50 text-sky-700 ring-sky-200",
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TIER_STYLES[tier] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}
    >
      {tier}
    </span>
  );
}

export function AdminBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
      Admin
    </span>
  );
}
