"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string };

/**
 * The main navigation. next/link prefetches every link in view in production; because each section has a
 * loading.tsx, that prefetch fetches its skeleton, so a click shows the page frame instantly while the data
 * streams in. (Default prefetching, not prefetch={true}: that would cache the live data of the page too.)
 */
export function NavLinks({ items, variant = "member" }: { items: NavItem[]; variant?: "member" | "admin" }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  // On narrow screens the nav scrolls sideways; keep the current page visible.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  const active = variant === "admin" ? "bg-warning-bg text-warning" : "bg-primary text-on-primary";
  return (
    <>
      {items.map((item) => {
        // "/admin" is only active on itself, not on its children.
        const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            ref={isActive ? activeRef : undefined}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`shrink-0 rounded-lg px-2 py-1.5 sm:px-3 text-sm font-medium transition ${isActive ? active : "text-muted hover:bg-surface-3 hover:text-fg"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
