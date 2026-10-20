"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GridIcon, ChartIcon, BookIcon, LibraryIcon } from "./icons";
import type { ComponentType } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  // Matches the dashboard itself and any run detail page -- both are part
  // of the same "your projects" area from the sidebar's point of view.
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: GridIcon,
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/runs"),
  },
  {
    href: "/programs",
    label: "Programs",
    icon: ChartIcon,
    isActive: (pathname) => pathname.startsWith("/programs"),
  },
  {
    href: "/knowledge",
    label: "Knowledge base",
    icon: LibraryIcon,
    isActive: (pathname) => pathname.startsWith("/knowledge"),
  },
  {
    href: "/manual",
    label: "Manual",
    icon: BookIcon,
    isActive: (pathname) => pathname.startsWith("/manual"),
  },
];

/**
 * The app's one persistent piece of navigation -- every other nav element
 * (the manual's own section list, a run's section panel) lives inside the
 * content area to the right of this. Kept as a thin client component so
 * only the active-state check needs the pathname; the shell around it
 * (GlobalShell) stays a server component.
 */
export default function GlobalNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-primary-light text-primary"
                : "text-foreground hover:bg-surface hover:text-primary"
            }`}
          >
            <Icon
              className={`h-4 w-4 ${active ? "text-primary" : "text-muted"}`}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The same destinations as icons, for the main menu's collapsed strip (CollapsibleRail). */
export function GlobalNavRail() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col items-center gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon, isActive }) => {
        const active = isActive(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-primary ${active ? "bg-primary-light text-primary" : "text-slate-600 hover:bg-surface hover:text-primary"}`}
          >
            <Icon className="h-4 w-4" />
          </Link>
        );
      })}
    </nav>
  );
}
