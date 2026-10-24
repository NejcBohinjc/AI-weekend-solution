const TIER_STYLES: Record<string, string> = {
  Core: "bg-indigo-bg text-indigo ring-indigo-line",
  Impact: "bg-success-bg text-success ring-success-line",
  "GO!": "bg-info-bg text-info ring-info-line",
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TIER_STYLES[tier] ?? "bg-surface-3 text-fg-2 ring-line"}`}
    >
      {tier}
    </span>
  );
}

export function AdminBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning ring-1 ring-inset ring-warning-line">
      Admin
    </span>
  );
}
