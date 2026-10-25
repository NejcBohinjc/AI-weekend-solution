// Small building blocks of the look: the page title with one italic accent word, the numbered eyebrow label,
// the arrow for primary buttons, and a friendly empty state. No client code here.
import Link from "next/link";
import { cardClass, primaryButtonClass } from "./ui";

/** "Your *tasks*": the heading style of the site, with one italic serif accent word in the brand colour. */
export function PageTitle({ children, accent, sub, as: Tag = "h1" }: { children?: React.ReactNode; accent: string; sub?: React.ReactNode; as?: "h1" | "h2" }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Tag className="font-display text-[clamp(2rem,6.5vw,3.25rem)] font-semibold leading-[1.05] tracking-display">
        {children}
        {children ? " " : ""}
        <em className="pr-[0.08em] font-serif font-normal italic text-brand">{accent}</em>
      </Tag>
      {sub && <p className="max-w-prose text-base text-muted">{sub}</p>}
    </div>
  );
}

/** A section heading: small tracked label, optionally numbered ("02 — Projects"), with the site's square bullet. */
export function Eyebrow({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-eyebrow text-brand">
      <span aria-hidden className="size-1.5 bg-brand" />
      {n !== undefined && <span className="tabular-nums">{String(n).padStart(2, "0")} —</span>}
      {children}
    </p>
  );
}

/** A section: eyebrow, optional quiet action on the right, content. */
export function Section({ n, title, action, children, id }: { n?: number; title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow n={n}>{title}</Eyebrow>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition-transform group-hover:translate-x-1 ${className}`}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** A primary pill link with an arrow. */
export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`group ${primaryButtonClass}`}>
      {children}
      <Arrow />
    </Link>
  );
}

/** One friendly line and one clear next step. */
export function EmptyState({ title, hint, href, action }: { title: string; hint?: string; href?: string; action?: string }) {
  return (
    <div className={`${cardClass} flex flex-col items-center gap-3 border-dashed py-10 text-center shadow-none`}>
      <p className="font-display text-lg font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {href && action && <PrimaryLink href={href}>{action}</PrimaryLink>}
    </div>
  );
}
