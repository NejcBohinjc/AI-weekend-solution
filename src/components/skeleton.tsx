// Placeholders shown at once while a page's data loads (the loading.tsx files). Plain blocks in the surface
// tokens, so they match both themes; the shapes roughly follow the real pages to avoid a jump.

function Pulse({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-3 ${className}`} />;
}

function Heading() {
  return (
    <div className="flex flex-col gap-2">
      <Pulse className="h-8 w-48" />
      <Pulse className="h-4 w-72 max-w-full" />
    </div>
  );
}

function Card({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
      <Pulse className="h-4 w-32" />
      {Array.from({ length: lines }, (_, i) => (
        <Pulse key={i} className={`h-5 ${i % 2 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

function List({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 px-4 py-3">
          <Pulse className={`h-5 ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-2/3" : "w-1/2"}`} />
          <Pulse className="h-4 w-40" />
        </div>
      ))}
    </div>
  );
}

/** A heading, optional filter chips, optional cards and a list. `narrow` matches the member pages' 2xl column. */
export function PageSkeleton({ narrow = false, filters = false, cards = 0, rows = 0 }: { narrow?: boolean; filters?: boolean; cards?: number; rows?: number }) {
  return (
    <section className={`flex flex-col gap-4 ${narrow ? "max-w-2xl" : ""}`} role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Heading />
      {filters && (
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Pulse key={i} className="h-7 w-20 shrink-0 rounded-full" />
          ))}
        </div>
      )}
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i} lines={i === 0 ? 3 : 2} />
      ))}
      {rows > 0 && <List rows={rows} />}
    </section>
  );
}

/** Analytics: filters, four tiles and two chart cards. */
export function AnalyticsSkeleton() {
  return (
    <section className="flex flex-col gap-5" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Heading />
      <div className="flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Pulse key={i} className="h-9 w-32" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5 shadow-card">
            <Pulse className="h-4 w-24" />
            <Pulse className="h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card">
            <Pulse className="h-5 w-48" />
            <Pulse className="h-4 w-full" />
            <Pulse className="h-48 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}
