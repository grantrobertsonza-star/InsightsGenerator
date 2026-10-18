import CollapsibleRail from "./CollapsibleRail";
import GlobalNav from "./GlobalNav";
import AccountPanel from "./AccountPanel";

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
 *
 * The rail can be hidden to a narrow strip and shown again (CollapsibleRail), for more room
 * on the working screens; the choice is remembered per browser.
 */
export default function GlobalShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full">
      <CollapsibleRail>
        <GlobalNav />
        {/* A run's own section nav (RunNav, in RunShell.tsx) portals its
            list into this slot so there's one sidebar column, not two --
            it's empty and takes no space on every other page. It stays
            mounted while the rail is hidden, so the portal keeps its target. */}
        <div id="run-nav-slot" className="mt-2 flex min-h-0 flex-1 flex-col" />
        <AccountPanel />
      </CollapsibleRail>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
