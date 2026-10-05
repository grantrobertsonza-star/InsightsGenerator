"use client";

import { useState, type ReactNode } from "react";

export type WorkingDataTab = {
  id: string;
  label: string;
  headerRight?: ReactNode;
  content: ReactNode;
};

/**
 * The "Working data" section used to stack pre-insights, all-recommendations,
 * and history on top of each other inside one collapsible card, each under
 * its own divider. On a run with a lot in each bucket that reads as one
 * long scroll rather than three distinct things, so this swaps the stack
 * for tabs: one bucket visible at a time, switching feels like the
 * independent expand/contract each of these had before they were
 * consolidated under "Working data" in the first place. All three tabs'
 * content is still rendered server-side regardless of which is active (the
 * same cost the stacked layout already had), this only changes what's
 * visible at once, not what's computed.
 */
export default function WorkingDataTabs({ tabs }: { tabs: WorkingDataTab[] }) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab.id === active?.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:border-slate-300 hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {active?.headerRight}
      </div>
      {active?.content}
    </div>
  );
}
