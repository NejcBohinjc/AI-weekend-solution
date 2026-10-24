export function AccessStatus({ active, hasPassword, linkPending }: { active: boolean; hasPassword: boolean; linkPending: boolean }) {
  const [label, style] = !active
    ? ["Deactivated", "bg-surface-4 text-fg-2"]
    : linkPending
      ? ["Link pending", "bg-info-bg text-info"]
      : hasPassword
        ? ["Can sign in", "bg-success-bg text-success"]
        : ["No password", "bg-danger-bg text-danger"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
