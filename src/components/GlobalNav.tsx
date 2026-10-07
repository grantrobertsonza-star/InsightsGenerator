"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GridIcon, ChartIcon, BookIcon } from "./icons";
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
