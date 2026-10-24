"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SectionIcon } from "@/components/sectionIcons";
import { publishOpenSection } from "@/components/openSection";

export type RunNavSection = {
  id: string;
  group: string;
  label: string;
  badge?: number;
  /** Other sections this entry stands for: it is shown active while any of them is open. */
  activeFor?: string[];
};

// Folded sidebar groups (Grant, 2026-10-22: "a roll up button on each side navigation section"),
// remembered per browser. Storage can be blocked (private windows, previews), so every read and
// write is guarded and a fold still applies for the page view.
const FOLDED_KEY = "run-nav-folded:v1";
const FOLDED_EVENT = "run-nav-folded";
let foldedInPage: string | null = null;
function readFolded(): string {
  if (foldedInPage !== null) return foldedInPage;
  try {
    return window.localStorage.getItem(FOLDED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function subscribeFolded(onChange: () => void) {
  const storageChanged = (e: StorageEvent) => {
    if (e.key === null || e.key === FOLDED_KEY) foldedInPage = null;
    onChange();
  };
  window.addEventListener("storage", storageChanged);
  window.addEventListener(FOLDED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(FOLDED_EVENT, onChange);
  };
}
function parseFolded(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeFolded(groups: string[]) {
  foldedInPage = JSON.stringify(groups);
  try {
    window.localStorage.setItem(FOLDED_KEY, foldedInPage);
  } catch {
    // Not remembered; the fold still applies for this page view.
  }
  window.dispatchEvent(new Event(FOLDED_EVENT));
}

const RunSectionContext = createContext<{
  selected: string;
  setSelected: (id: string) => void;
} | null>(null);

export function useRunSection() {
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
    // A link naming a section (?section=, from the main dashboard's next step) opens it; otherwise
    // the one remembered for this run.
    const linked = new URLSearchParams(window.location.search).get("section");
    if (linked && (!validIds || validIds.includes(linked))) {
      setSelectedState(linked);
      try {
        window.sessionStorage.setItem(storageKey(), linked);
      } catch {
        // storage blocked: the link still opens the section
      }
      return;
    }
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
export function GoToSection({ id, children, secondary = false }: { id: string; children: ReactNode; secondary?: boolean }) {
  const { setSelected } = useRunSection();
  return (
    <button
      type="button"
      onClick={() => setSelected(id)}
      className={
        secondary
          ? "rounded-lg border border-primary bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light"
          : "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90"
      }
    >
      {children}
    </button>
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
  const [railEl, setRailEl] = useState<Element | null>(null);

  useEffect(() => {
    setPortalEl(document.getElementById("run-nav-slot"));
    setRailEl(document.getElementById("run-nav-rail"));
  }, []);

  // The floating Research assistant reads the open section from here (components/openSection.ts).
  const openLabel = sections.find((s) => s.id === selected || (s.activeFor ?? []).includes(selected))?.label ?? selected;
  useEffect(() => {
    publishOpenSection({ runId: currentProjectId, id: selected, label: openLabel });
  }, [currentProjectId, selected, openLabel]);
  useEffect(() => () => publishOpenSection(null), []);

  // The server and the first client render show every group open; a remembered fold applies after.
  const folded = parseFolded(useSyncExternalStore(subscribeFolded, readFolded, () => "[]"));
  const toggleGroup = (name: string) => writeFolded(folded.includes(name) ? folded.filter((g) => g !== name) : [...folded, name]);

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
      {groups.map((group) => {
        const isFolded = folded.includes(group.name);
        const listId = `run-nav-group-${group.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        // A folded group hides all its entries, the open one too (Grant, 2026-10-22: Research quality
        // stayed under a rolled-up Prepare); its heading is coloured instead, so the open section's
        // group is still visible.
        const holdsOpen = group.items.some((s) => s.id === selected || (s.activeFor ?? []).includes(selected));
        const shownItems = isFolded ? [] : group.items;
        return (
        <div key={group.name} role="group" aria-label={group.name} className={`mt-1 border-t border-slate-200 px-3 pt-3 ${isFolded && shownItems.length === 0 ? "pb-2" : "pb-3"}`}>
          <button
            type="button"
            onClick={() => toggleGroup(group.name)}
            aria-expanded={!isFolded}
            aria-controls={listId}
            title={isFolded ? `Show ${group.name}${holdsOpen ? " (the open section is here)" : ""}` : `Roll up ${group.name}`}
            data-testid="run-nav-group-toggle"
            data-holds-open={isFolded && holdsOpen ? "true" : undefined}
            className={`mb-1.5 flex w-full items-center gap-2 rounded px-3 py-0.5 text-left text-[11px] font-bold uppercase tracking-wider hover:text-primary focus-visible:outline-2 focus-visible:outline-primary ${isFolded && holdsOpen ? "text-primary" : "text-slate-700"}`}
          >
            <span aria-hidden="true" className="h-3 w-1 rounded-full bg-primary/60" />
            <span className="flex-1">{group.name}</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${isFolded ? "-rotate-90" : ""}`}>
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div id={listId} className="flex flex-col gap-0.5">
            {shownItems.map((section) => {
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
        );
      })}
    </div>
  );

  // The same sections as icons for the collapsed main menu (Grant, 2026-10-20), grouped as above
  // with a rule between groups, each named on hover and to assistive technology.
  const rail = (
    <div className="flex w-full flex-col items-center" data-testid="run-nav-rail">
      {groups.map((group) => (
        <div key={group.name} role="group" aria-label={group.name} className="flex w-full flex-col items-center gap-1 border-t border-slate-200 py-2">
          {group.items.map((section) => {
            const active = section.id === selected || (section.activeFor ?? []).includes(selected);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setSelected(section.id)}
                aria-label={section.label}
                title={section.label}
                aria-current={active ? "page" : undefined}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-primary ${active ? "bg-primary-light text-primary" : "text-slate-600 hover:bg-surface hover:text-primary"}`}
              >
                <SectionIcon id={section.id} label={section.label} className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  if (!portalEl) return null;
  return (
    <>
      {createPortal(content, portalEl)}
      {railEl && createPortal(rail, railEl)}
    </>
  );
}
