"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { manualSections, manualHref } from "./sections";

export function ManualNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {manualSections.map((section) => {
        const href = manualHref(section.slug);
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`block rounded-lg px-3 py-2 text-sm transition ${
              isActive
                ? "bg-primary-light font-medium text-primary"
                : "text-foreground hover:bg-surface"
            }`}
          >
            <div>{section.title}</div>
            <div className={`text-xs ${isActive ? "text-primary/70" : "text-muted"}`}>{section.blurb}</div>
          </Link>
        );
      })}
    </nav>
  );
}
