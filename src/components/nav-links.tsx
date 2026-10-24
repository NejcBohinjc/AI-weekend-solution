"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type NavItem = { href: string; label: string };

export function NavLinks({ items, variant = "member" }: { items: NavItem[]; variant?: "member" | "admin" }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);
  // On narrow screens the nav scrolls sideways; keep the current page visible.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  const active = variant === "admin" ? "bg-amber-100 text-amber-900" : "bg-slate-900 text-white";
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
            className={`shrink-0 rounded-lg px-2 py-1.5 sm:px-3 text-sm font-medium transition ${isActive ? active : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
