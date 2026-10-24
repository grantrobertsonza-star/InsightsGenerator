"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { CROSSTAB_STATE_NOTE, initialCrosstabDataset, type CrosstabDatasetState } from "@/lib/crosstabEntry";
import { useGoToSection } from "./RunShell";
import { dataFileLink } from "./stageLinks";

export type DataFileOption = {
  id: string;
  filename: string;
  state: CrosstabDatasetState;
  /** Tables saved for this file (drafts and committed). */
  savedTables: number;
  /** Of those, drafts not yet committed and committed tables, for the stage status. */
  draftTables?: number;
  committedTables?: number;
  /**
   * What the section shows for this file, prepared on the server: for a file that cannot be opened
   * (setup to accept, aggregated tables), its own controls; for an open file, when the section has
   * no renderReady, its content (Analytics' tool grid).
   */
  node?: ReactNode;
};

// The data file used last in this project, shared by Cross tabs and Analytics so moving between them
// keeps the same file. A per-browser convenience: without storage, the first file that can open.
const lastUsedKey = (runId: string) => `data-file-last:${runId}`;
const CHANGE = "data-file-last";
function readLastUsed(runId: string): string | null {
  try {
    return window.localStorage.getItem(lastUsedKey(runId));
  } catch {
    return null;
  }
}
function writeLastUsed(runId: string, id: string) {
  try {
    window.localStorage.setItem(lastUsedKey(runId), id);
  } catch {
    // Storage unavailable: the choice holds for this page view only.
  }
  window.dispatchEvent(new Event(CHANGE));
}
const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
};

/**
 * A section that works on one data file at a time, chosen in its header (Cross tabs and Analytics,
 * Grant's reviews of 2026-10-20), in the Import screen's workspace style. It decides which file
 * opens (lib/crosstabEntry.ts), says plainly why a file cannot open, and links to Findings and to
 * Sources, where files are added, set up and deleted. Opening it builds nothing and calls no model.
 *
 * With renderReady, an open file's content is the caller's (the crosstab workspace), and every file
 * opened in this page view stays mounted, hidden, so switching files keeps unsaved work. Without it,
 * an open file shows a header card with the chooser above the file's own node.
 */
export default function DataFileSection({
  runId,
  title,
  intro,
  howTitle,
  how,
  emptyText,
  aggregatedText,
  datasets,
  findings,
  renderReady,
  testIds,
}: {
  runId: string;
  title: string;
  /** One line under the title, for a section without its own header (Analytics). */
  intro?: string;
  howTitle: string;
  how: ReactNode;
  emptyText: string;
  aggregatedText: string;
  datasets: DataFileOption[];
  findings: number;
  renderReady?: (d: DataFileOption, selector: ReactNode) => ReactNode;
  testIds: { section: string; select: string; state: string; findings: string };
}) {
  const goTo = useGoToSection();
  const lastUsed = useSyncExternalStore(subscribe, () => readLastUsed(runId), () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  const currentId = chosen && datasets.some((d) => d.id === chosen) ? chosen : initialCrosstabDataset(datasets, lastUsed);
  const current = datasets.find((d) => d.id === currentId) ?? null;
  // Files opened in this page view, kept mounted (hidden) so their unsaved work survives a switch.
  const [opened, setOpened] = useState<string[]>([]);
  const mounted = renderReady ? datasets.filter((d) => d.state === "ready" && (opened.includes(d.id) || d.id === currentId)) : [];

  const choose = (id: string) => {
    setChosen(id);
    setOpened((o) => (currentId && !o.includes(currentId) ? [...o, currentId] : o));
    writeLastUsed(runId, id);
  };

  // A link from a section dashboard chooses its file here, as the header's chooser does.
  // Subscribed on every render (no dependency list), so the handler always sees the current files
  // and choice; subscribing is cheap.
  useEffect(() => {
    // A request from before this section first mounted is taken once it has.
    const timer = window.setTimeout(() => {
      const waiting = dataFileLink.takePending();
      if (waiting && datasets.some((d) => d.id === waiting)) choose(waiting);
    });
    const unsubscribe = dataFileLink.subscribe((id) => {
      if (datasets.some((d) => d.id === id)) choose(id);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  });

  const selector =
    datasets.length > 0 ? (
      <label className="flex items-center gap-2 text-sm">
        <span className="sr-only">Data file</span>
        <select
          aria-label="Data file"
          value={currentId ?? ""}
          onChange={(e) => choose(e.target.value)}
          className="max-w-[28rem] rounded-lg border border-primary/40 bg-white px-2.5 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          data-testid={testIds.select}
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {`${d.filename}${d.state === "ready" ? "" : ` (${CROSSTAB_STATE_NOTE[d.state]})`}${d.savedTables > 0 ? `, ${d.savedTables} ${d.savedTables === 1 ? "table" : "tables"}` : ""}`}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const links = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <button type="button" onClick={() => goTo("findings")} className="font-medium text-primary hover:underline" data-testid={testIds.findings}>
        {`Findings (${findings})`}
      </button>
      <button type="button" onClick={() => goTo("upload")} className="font-medium text-primary hover:underline">
        Data files are added, set up and deleted in Sources
      </button>
      <details className="relative text-slate-600">
        <summary className="cursor-pointer select-none hover:text-foreground">{howTitle}</summary>
        <div className="absolute left-0 z-30 mt-1 w-[28rem] max-w-[90vw] space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed shadow-lg">{how}</div>
      </details>
    </div>
  );

  const heading = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {selector}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-slate-100 p-4 sm:p-6" data-testid={testIds.section}>
      {datasets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{emptyText}</p>
          <button type="button" onClick={() => goTo("upload")} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover">
            Go to Sources
          </button>
        </div>
      ) : (
        <>
          {links}
          {renderReady &&
            mounted.map((d) => (
              <div key={d.id} className={d.id === currentId ? "" : "hidden"}>
                {renderReady(d, d.id === currentId ? selector : null)}
              </div>
            ))}
          {!renderReady && current?.state === "ready" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                {heading}
                {intro && <p className="mt-0.5 text-xs text-slate-600">{intro}</p>}
              </div>
              {current.node}
            </div>
          )}
          {current && current.state !== "ready" && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={testIds.state}>
              {heading}
              {current.state === "failed" && (
                <p className="text-sm text-danger">The last processing of this file failed, so it cannot be opened here. Fix or replace it in Sources.</p>
              )}
              {current.state === "unsupported" && (
                <p className="text-sm text-slate-600">This file is case-level data in a format this section does not read. Add it as SPSS, Stata, CSV or Excel in Sources (SAS files are not supported yet).</p>
              )}
              {current.state === "aggregated" && <p className="text-sm text-slate-600">{aggregatedText}</p>}
              {current.node}
            </div>
          )}
        </>
      )}
    </div>
  );
}
