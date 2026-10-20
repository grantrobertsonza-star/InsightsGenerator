"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";

/**
 * The left rail's hide and show control (Grant, 2026-10-18: more room for the working panes).
 *
 * Hidden, the rail shrinks to a narrow strip with the brand mark, a "Show main menu" button and, below
 * them, `rail`: an icon for each main destination and each of a project's sections (Grant,
 * 2026-10-20), named on hover, so the strip is still a menu rather than empty space. Its
 * content (the global links, a run's section list portalled into #run-nav-slot, the account panel)
 * stays mounted and is only hidden, so RunNav keeps its portal target and nothing in it is lost.
 *
 * The choice is a per-browser convenience in localStorage, read after hydration through
 * useSyncExternalStore: the server render and the first client render are always the open rail (no
 * hydration mismatch), and a remembered hidden rail is applied straight after. Storage that throws
 * (private window, blocked site data) means the choice applies to this page view only; an in-page
 * copy keeps the toggle working.
 */

const STORAGE_KEY = "global-rail:collapsed";
const CHANGE_EVENT = "global-rail-layout";
let pageValue: string | null | undefined; // undefined: not set in this page view

function readStored(): string | null {
  if (pageValue !== undefined) return pageValue;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(collapsed: boolean) {
  pageValue = collapsed ? "1" : "0";
  try {
    window.localStorage.setItem(STORAGE_KEY, pageValue);
  } catch {
    // Storage unavailable: the choice still applies in this page view, it just is not remembered.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) pageValue = undefined; // another tab changed it
    onChange();
  };
  window.addEventListener("storage", storageChanged);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export default function CollapsibleRail({ children, rail }: { children: ReactNode; rail?: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, () => readStored() === "1", () => false);
  const toggleClass =
    "flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border bg-white text-muted hover:border-slate-400 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return (
    <aside
      className={`flex flex-none flex-col border-r border-border bg-white py-5 ${collapsed ? "w-12 items-center" : "w-56"}`}
      data-testid="global-rail"
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* The strip is always rendered (hidden while the rail is open) so the run's icon list keeps
          its portal target (#run-nav-rail) whichever way the rail is shown. */}
      <div className={collapsed ? "flex min-h-0 flex-1 flex-col items-center gap-3" : "hidden"}>
        <Link href="/" aria-label="Insights Elevator home" title="Insights Elevator" className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white shadow-sm">
          IE
        </Link>
        <button type="button" onClick={() => writeStored(false)} aria-label="Show main menu" title="Show main menu" aria-expanded={false} aria-controls="global-rail-content" className={toggleClass}>
          <Chevron direction="right" />
        </button>
        {rail && <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-slate-200 pt-3" data-testid="global-rail-icons">{rail}</div>}
      </div>
      {collapsed ? null : (
        <div className="mb-6 flex items-center gap-1 pr-2">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 pl-4">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary text-sm font-bold text-white shadow-sm">IE</div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-foreground">Insights Elevator</div>
              <div className="truncate text-[11px] text-muted">Decision-ready insights</div>
            </div>
          </Link>
          <button type="button" onClick={() => writeStored(true)} aria-label="Hide main menu" title="Hide main menu" aria-expanded={true} aria-controls="global-rail-content" className={toggleClass}>
            <Chevron direction="left" />
          </button>
        </div>
      )}
      <div id="global-rail-content" className={collapsed ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        {children}
      </div>
    </aside>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={direction === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
