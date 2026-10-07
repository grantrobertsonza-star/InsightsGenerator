"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type RunNavSection = {
  id: string;
  group: string;
  label: string;
  badge?: number;
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

export function SectionPanel({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { selected } = useRunSection();
  return <div className={selected === id ? "block" : "hidden"}>{children}</div>;
}

// Renders into GlobalShell's "run-nav-slot" div (via portal) so a run's
// section list sits directly under the global Dashboard/Programs/Manual
// items, in one sidebar column, rather than opening a second column of
// its own and eating into the content width.
export function RunNav({ sections }: { sections: RunNavSection[] }) {
  const { selected, setSelected } = useRunSection();
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
      {groups.map((group) => (
        <div key={group.name} className="mb-3 px-3">
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {group.name}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((section) => {
              const active = section.id === selected;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setSelected(section.id)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                    active
                      ? "bg-primary-light text-primary"
                      : "text-foreground hover:bg-surface hover:text-primary"
                  }`}
                >
                  <span>{section.label}</span>
                  {typeof section.badge === "number" && section.badge > 0 && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs ${active ? "bg-primary text-white" : "bg-surface text-muted"}`}
                    >
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
