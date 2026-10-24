export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-8 text-center text-sm text-subtle">
        {description}
        <div className="mt-1 text-xs text-subtle">Coming soon.</div>
      </div>
    </section>
  );
}
