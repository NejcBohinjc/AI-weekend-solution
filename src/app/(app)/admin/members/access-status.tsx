export function AccessStatus({ active, hasPassword, linkPending }: { active: boolean; hasPassword: boolean; linkPending: boolean }) {
  const [label, style] = !active
    ? ["Deactivated", "bg-slate-200 text-slate-700"]
    : linkPending
      ? ["Link pending", "bg-sky-50 text-sky-800"]
      : hasPassword
        ? ["Can sign in", "bg-emerald-50 text-emerald-800"]
        : ["No password", "bg-red-50 text-red-700"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
