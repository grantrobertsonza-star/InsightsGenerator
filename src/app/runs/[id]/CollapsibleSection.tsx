"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";

/**
 * A run's page walks through four stages in order (upload, process, decide,
 * review), and showing all four fully expanded at once is what made the
 * page unreasonably long to scroll. This wraps each stage's section so only
 * the one currently relevant defaults to open, while a finished stage
 * collapses to its header rather than disappearing, since its content (the
 * document list, the decision brief) stays useful to glance back at.
 *
 * The caller passes a `stageKey` that changes whenever the run's current
 * stage changes (see RunPage): giving every section the same key forces a
 * remount, so `defaultOpen` is recalculated fresh, an already-open section
 * that's no longer the active one collapses on its own, but a manual toggle
 * within the same stage isn't fought by state resetting under it.
 */
export default function CollapsibleSection({
  title,
  icon,
  defaultOpen,
  headerRight,
  children,
  bare = false,
}: {
  title: string;
  icon: ReactNode;
  defaultOpen: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
  // Used when this section is rendered as a panel inside RunShell: the
  // panel's own nav item already carries the title, and the panel is
  // shown or hidden by RunShell rather than by this component's own
  // open/closed state, so the card chrome and collapse button would just
  // be a second, redundant header. headerRight still renders (e.g. the
  // CSV export link, the per-table process buttons) -- those actions
  // aren't shown anywhere else -- just above the content instead of
  // inline with a title that's no longer here.
  bare?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (bare) {
    return (
      <div>
        {headerRight && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {headerRight}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <section className="card-surface mb-8 rounded-xl border border-border bg-white p-6">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-left text-base font-semibold text-foreground"
        >
          <ChevronDownIcon
            className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
          />
          {icon}
          {title}
        </button>
        {headerRight}
      </div>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
}
