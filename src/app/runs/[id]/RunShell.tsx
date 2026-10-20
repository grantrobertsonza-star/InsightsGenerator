"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export type RunNavSection = {
  id: string;
  group: string;
  label: string;
  badge?: number;
  /** Other sections this entry stands for: it is shown active while any of them is open. */
  activeFor?: string[];
};

const RunSectionContext = createContext<{
  selected: string;
  setSelected: (id: string) => void;
} | null>(null);

function useRunSection() {
  const ctx = useContext(RunSectionContext);
  if (!ctx)
    throw new Error(
      "SectionPanel/RunNav must be used inside a RunSectionProvider",
    );
  return ctx;
}

export function RunSectionProvider({
  defaultId,
  validIds,
  children,
}: {
  defaultId: string;
  // Sections that exist, so a remembered one that no longer does is ignored.
  validIds?: string[];
  children: ReactNode;
}) {
  const [selected, setSelectedState] = useState(defaultId);
  const storageKey = () => `run-section:${window.location.pathname}`;

  // Remember the section per run, so a reload (or the refresh after saving)
  // returns to where you were instead of the default section.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey());
      if (saved && saved !== defaultId && (!validIds || validIds.includes(saved)))
        setSelectedState(saved);
    } catch {
      // storage blocked: stay on the default section
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSelected = (id: string) => {
    setSelectedState(id);
    try {
      window.sessionStorage.setItem(storageKey(), id);
    } catch {
      // storage blocked: the choice just is not remembered
    }
  };
  return (
    <RunSectionContext.Provider value={{ selected, setSelected }}>
      {children}
    </RunSectionContext.Provider>
  );
}

/** Switches the run to another section from any client component inside the provider. */
export function useGoToSection(): (id: string) => void {
  return useRunSection().setSelected;
}

/** A button that switches the run to another section of the sidebar. */
export function GoToSection({ id, children }: { id: string; children: ReactNode }) {
  const { setSelected } = useRunSection();
  return (
    <button
      type="button"
      onClick={() => setSelected(id)}
      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90"
    >
      {children}
    </button>
  );
}

/**
 * Tabs across sections that share one sidebar entry (Objectives: Set and Review, Grant 2026-10-19).
 * Each tab switches the run to its section, as the sidebar does.
 */
export function SectionTabs({ tabs }: { tabs: { id: string; label: string }[] }) {
  const { selected, setSelected } = useRunSection();
  return (
    <div role="tablist" className="mb-3 flex gap-5 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={selected === t.id}
          onClick={() => setSelected(t.id)}
          className={`-mb-px border-b-2 px-0.5 pb-2 text-sm font-medium ${
            selected === t.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SectionPanel({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { selected } = useRunSection();
  // A section's client components are mounted the first time it is opened and
  // then kept (hidden), so state survives switching but a page load does not
  // pay to render and hydrate all fourteen sections at once.
  const [visited, setVisited] = useState(selected === id);
  if (selected === id && !visited) setVisited(true);
  return <div className={selected === id ? "block" : "hidden"}>{visited ? children : null}</div>;
}

// Renders into GlobalShell's "run-nav-slot" div (via portal) so a run's
// section list sits directly under the global Dashboard/Programs/Manual
// items, in one sidebar column, rather than opening a second column of
// its own and eating into the content width.
export function RunNav({
  sections,
  projects,
  currentProjectId,
}: {
  sections: RunNavSection[];
  /** The organisation's projects, for the current-project switcher (lib/projectList.ts). */
  projects: { id: string; name: string }[];
  currentProjectId: string;
}) {
  const { selected, setSelected } = useRunSection();
  const router = useRouter();
  const [portalEl, setPortalEl] = useState<Element | null>(null);

  useEffect(() => {
    setPortalEl(document.getElementById("run-nav-slot"));
  }, []);

  const groups: { name: string; items: RunNavSection[] }[] = [];
  for (const section of sections) {
    const existing = groups.find((g) => g.name === section.group);
    if (existing) existing.items.push(section);
    else groups.push({ name: section.group, items: [section] });
  }

  const content = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border pt-3">
      {/* The current project, then the stages in the grouping of Grant's sidebar (2026-10-19, adopted
          on this copy 2026-10-20 in its existing style). Groups are separated by a rule and spacing,
          with headings that read as headings rather than entries. */}
      <div className="px-3 pb-3">
        <label htmlFor="current-project" className="mb-1.5 block px-3 text-[11px] font-bold uppercase tracking-wider text-slate-700">
          Current project
        </label>
        <select
          id="current-project"
          value={currentProjectId}
          onChange={(e) => router.push(`/runs/${e.target.value}`)}
          className="w-full truncate rounded-lg border border-border bg-white px-2.5 py-2 text-sm text-foreground"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {groups.map((group) => (
        <div key={group.name} role="group" aria-label={group.name} className="mt-1 border-t border-slate-200 px-3 pb-3 pt-3">
          <div className="mb-1.5 flex items-center gap-2 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-700">
            <span aria-hidden="true" className="h-3 w-1 rounded-full bg-primary/60" />
            {group.name}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((section) => {
              const active = section.id === selected || (section.activeFor ?? []).includes(selected);
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setSelected(section.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    active ? "bg-primary-light text-primary" : "text-foreground hover:bg-surface hover:text-primary"
                  }`}
                >
                  <span data-nav-label>{section.label}</span>
                  {typeof section.badge === "number" && section.badge > 0 && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${active ? "bg-primary text-white" : "bg-surface text-muted"}`}>
                      {section.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (!portalEl) return null;
  return createPortal(content, portalEl);
}
