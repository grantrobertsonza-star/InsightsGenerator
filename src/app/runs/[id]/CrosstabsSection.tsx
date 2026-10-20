"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CROSSTAB_STATE_NOTE, initialCrosstabDataset, type CrosstabDatasetState } from "@/lib/crosstabEntry";
import CrosstabWorkspace from "./CrosstabWorkspace";
import { useGoToSection } from "./RunShell";

export type CrosstabDataset = {
  id: string;
  filename: string;
  state: CrosstabDatasetState;
  /** Tables saved for this file (drafts and committed). */
  savedTables: number;
  /** For a file that is not opened in the workspace: what the section shows instead (prepared on the server). */
  node?: ReactNode;
};

const lastUsedKey = (runId: string) => `crosstabs-last-file:${runId}`;
const CHANGE = "crosstabs-last-file";
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
 * Cross tabs opens straight into the crosstab workspace (Grant's review, 2026-10-20), replacing the
 * page that only listed data files and opened the workspace in a full-window overlay. The data file
 * is chosen in the workspace's header; with several, the one used last in this project opens (a
 * per-browser convenience; without it, the first file the workspace can open). Each file's workspace
 * stays mounted once opened, so switching files and back keeps an unfinished table, its filters and
 * its settings. Opening builds nothing and calls no model.
 *
 * Where the gateway's parts went: file selection, to the workspace header; dataset setup, to a
 * message with Accept and a link to Sources for a file whose setup needs it; the findings count, to a
 * link beside the title; the instructions and statistical notes, to "How Cross tabs works" (now
 * matching what the workspace applies) and the workspace's settings summary; deleting a data file,
 * to Sources, where every source is removed.
 */
export default function CrosstabsSection({ runId, datasets, findings }: { runId: string; datasets: CrosstabDataset[]; findings: number }) {
  const goTo = useGoToSection();
  const lastUsed = useSyncExternalStore(subscribe, () => readLastUsed(runId), () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  const currentId = chosen && datasets.some((d) => d.id === chosen) ? chosen : initialCrosstabDataset(datasets, lastUsed);
  const current = datasets.find((d) => d.id === currentId) ?? null;
  // Workspaces opened in this page view, kept mounted (hidden) so their unsaved work survives a switch.
  const [opened, setOpened] = useState<string[]>([]);
  const mounted = datasets.filter((d) => d.state === "ready" && (opened.includes(d.id) || d.id === currentId));

  const choose = (id: string) => {
    setChosen(id);
    setOpened((o) => (currentId && !o.includes(currentId) ? [...o, currentId] : o));
    writeLastUsed(runId, id);
  };

  const selector =
    datasets.length > 0 ? (
      <label className="flex items-center gap-2 text-sm">
        <span className="sr-only">Data file</span>
        <select
          aria-label="Data file"
          value={currentId ?? ""}
          onChange={(e) => choose(e.target.value)}
          className="max-w-[28rem] rounded-lg border border-primary/40 bg-white px-2.5 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          data-testid="crosstab-file-select"
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
      <button type="button" onClick={() => goTo("findings")} className="font-medium text-primary hover:underline" data-testid="crosstab-findings-link">
        {`Findings (${findings})`}
      </button>
      <button type="button" onClick={() => goTo("upload")} className="font-medium text-primary hover:underline">
        Data files are added, set up and deleted in Sources
      </button>
      <details className="relative text-slate-600">
        <summary className="cursor-pointer select-none hover:text-foreground">How Cross tabs works</summary>
        <div className="absolute left-0 z-30 mt-1 w-[28rem] max-w-[90vw] space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed shadow-lg">
          <p>Choose rows and columns from the variable list and add the table to the set. Nothing is built or compared until you add a table, and opening this page calls no model. Commit the tables worth keeping and their comparisons become findings.</p>
          <p>Differences between columns are tested with the correction chosen under Table settings: false discovery rate (Benjamini-Hochberg) by default, or Bonferroni, or none. It is applied across the columns of each banner variable, row by row.</p>
          <p>With a PSU or strata variable set under Table settings, standard errors use Taylor series linearisation for the survey design; without one, they assume a simple random sample, with weights if a weight is chosen.</p>
          <p>Driver analysis, NPS, charts and the other analyses are under Analytics.</p>
        </div>
      </details>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-slate-100 p-4 sm:p-6" data-testid="crosstabs-section">
      {datasets.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Cross tabs</h2>
          <p className="mt-1 text-sm text-slate-600">No data files yet. Add a survey data file (SPSS, Stata, SAS, CSV or Excel) in Sources, then build tables here.</p>
          <button type="button" onClick={() => goTo("upload")} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover">
            Go to Sources
          </button>
        </div>
      ) : (
        <>
          {links}
          {mounted.map((d) => (
            <div key={d.id} className={d.id === currentId ? "" : "hidden"}>
              <CrosstabWorkspace layout="page" runId={runId} documentId={d.id} filename={d.filename} fileSelector={d.id === currentId ? selector : null} />
            </div>
          ))}
          {current && current.state !== "ready" && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="crosstab-file-state">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold text-foreground">Cross tabs</h2>
                {selector}
              </div>
              {current.state === "failed" && (
                <p className="text-sm text-danger">The last processing of this file failed, so it cannot be opened here. Fix or replace it in Sources.</p>
              )}
              {current.state === "unsupported" && (
                <p className="text-sm text-slate-600">This file is case-level data in a format the workspace does not read. Add it as SPSS, Stata, SAS, CSV or Excel in Sources.</p>
              )}
              {current.state === "aggregated" && (
                <p className="text-sm text-slate-600">This file holds tables that are already aggregated, so there is no variable list to cross-tabulate. Generate findings from its tables below.</p>
              )}
              {current.node}
            </div>
          )}
        </>
      )}
    </div>
  );
}
