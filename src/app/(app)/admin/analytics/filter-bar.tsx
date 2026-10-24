"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { value: string; label: string };

/** Tier, series and range in one row; every chart below follows them. Updates the URL right away. */
export function FilterBar({ filters }: { filters: { name: string; label: string; value: string; options: Option[] }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  return (
    <form className={`flex flex-wrap items-end gap-3 transition-opacity ${pending ? "opacity-60" : ""}`} aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
      {filters.map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-xs font-medium text-muted">
          {f.label}
          <select
            name={f.name}
            value={f.value}
            onChange={(e) => set(f.name, e.target.value)}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg shadow-sm"
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </form>
  );
}
