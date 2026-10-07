import Link from "next/link";
import GlobalNav from "./GlobalNav";

/**
 * The app's persistent left rail: brand identity plus the three top-level
 * destinations (Dashboard, Programs, Manual). Everything else -- a run's
 * own section nav, the manual's own ManualNav -- is a second, page-local
 * nav rendered inside the content area this shell hands to `children`.
 *
 * Replaces the horizontal `<header>` bar that used to be copy-pasted at
 * the top of page.tsx, programs/page.tsx and manual/layout.tsx: a fixed
 * top bar still puts everything below it in one long vertical scroll,
 * which is exactly what this redesign is meant to get away from.
 */
export default function GlobalShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full">
      <aside className="flex w-56 flex-none flex-col border-r border-border bg-white py-5">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-4">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary text-sm font-bold text-white shadow-sm">
            IE
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-foreground">
              Insights Elevator
            </div>
            <div className="truncate text-[11px] text-muted">
              Decision-ready insights
            </div>
          </div>
        </Link>
        <GlobalNav />
        {/* A run's own section nav (RunNav, in RunShell.tsx) portals its
            list into this slot so there's one sidebar column, not two --
            it's empty and takes no space on every other page. */}
        <div id="run-nav-slot" className="mt-2 flex min-h-0 flex-1 flex-col" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
