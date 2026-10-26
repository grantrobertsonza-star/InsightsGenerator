"use client";

import { useState, type ReactNode } from "react";
import { useGoToSection } from "./RunShell";
import { Pane, ThreePane } from "./ThreePane";

export type PickerItem = {
  id: string;
  name: string;
  /** A short second line under the name: the file's state, such as "Coded" or "Not extracted yet". */
  meta: string;
  /** Marks a state worth seeing at a glance ("Needs set-up"); routine states stay in `meta`. */
  flag?: string;
  /** The selected file's notes, in the side pane (Coding: quality control and exports). */
  side?: ReactNode;
  /** The selected file's work, rendered on the server. */
  node: ReactNode;
};

/**
 * A section that works on one file at a time (Coding, Secondary analysis), laid out like Cross tabs
 * and Analytics (Grant, 2026-10-20): the file is chosen from a list beside the title, with a line on
 * what the section does, a short summary, links to Findings and to Sources, and "How it works"
 * underneath. Below that the selected file's work fills the main pane and, for a section with notes
 * (Coding's quality and exports), the notes sit in a resizable pane beside it. `sideEmpty` says why
 * that pane is empty for a file with no notes yet, so the layout does not jump between files.
 * `footer` is for what spans every file (themes across transcripts).
 */
export default function DocumentPicker({
  title,
  chooserLabel,
  intro,
  howTitle,
  how,
  findings,
  items,
  summary,
  workLabel,
  sideLabel,
  sideEmpty,
  footer,
  empty,
  storageKey,
  testId,
}: {
  title: string;
  /** The chooser's accessible name ("Transcript"). */
  chooserLabel: string;
  intro: string;
  howTitle: string;
  how: ReactNode;
  findings: number;
  items: PickerItem[];
  /** A line of counts under the intro ("3 reports and decks · 12 findings"). */
  summary?: ReactNode;
  /** The main pane's title ("Coding"). */
  workLabel: string;
  /** The side pane's title ("Quality and exports"); without it the work takes the full width. */
  sideLabel?: string;
  /** What the side pane says for a file with no notes yet. */
  sideEmpty?: string;
  footer?: ReactNode;
  empty: string;
  storageKey: string;
  testId: string;
}) {
  const goTo = useGoToSection();
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  // Files opened so far. Their cards stay mounted, hidden, when another file is chosen (Codex IR-07,
  // 2026-10-20): a remount used to drop a running "Code themes" job's progress (so it looked idle and
  // could be started again) and any file chosen but not yet sent. Each file keeps its own subtree,
  // keyed by its id, so one file's state never shows on another. A file that has left the list (for
  // example deleted in Sources) is simply not rendered, and the selection falls back to the first.
  const [opened, setOpened] = useState<string[]>([]);
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const shown = items.filter((i) => i.id === selected?.id || opened.includes(i.id));
  const choose = (id: string) => {
    setOpened((o) => (selected && !o.includes(selected.id) ? [...o, selected.id] : o));
    setSelectedId(id);
  };
  // The file's state rides in the option text, since a native list cannot show the row badges.
  const optionText = (i: PickerItem) => [i.name, i.meta, i.flag].filter(Boolean).join(" · ");
  const work = selected && (
    <Pane side="workspace" title={workLabel}>
      {shown.map((i) => (
        <div key={`node-${i.id}`} className={i.id === selected.id ? "contents" : "hidden"}>
          {i.node}
        </div>
      ))}
    </Pane>
  );
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-slate-100 p-4 sm:p-6" data-testid={testId}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {items.length > 0 && (
            <select
              aria-label={chooserLabel}
              value={selected?.id ?? ""}
              onChange={(e) => choose(e.target.value)}
              className="max-w-[28rem] rounded-lg border border-primary/40 bg-white px-2.5 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              data-testid={`${testId}-select`}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {optionText(i)}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-sm text-slate-600">{intro}</p>
        {summary && <p className="text-xs text-slate-600" data-testid={`${testId}-summary`}>{summary}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <button type="button" onClick={() => goTo("findings")} className="font-medium text-primary hover:underline">
            {`Findings (${findings})`}
          </button>
          <button type="button" onClick={() => goTo("upload")} className="font-medium text-primary hover:underline">
            Files are added, set up and deleted in Sources
          </button>
          <details className="relative text-slate-600">
            <summary className="cursor-pointer select-none hover:text-foreground">{howTitle}</summary>
            <div className="absolute left-0 z-30 mt-1 w-[28rem] max-w-[90vw] space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed shadow-lg">{how}</div>
          </details>
        </div>
      </div>
      {items.length === 0 || !selected ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">{empty}</p>
          <button type="button" onClick={() => goTo("upload")} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover">
            Go to Sources
          </button>
        </div>
      ) : sideLabel ? (
        <ThreePane
          storageKey={storageKey}
          middle={work}
          right={
            <Pane side="workspace" title={sideLabel}>
              {shown.map((i) => (
                <div key={`side-${i.id}`} className={i.id === selected.id ? "contents" : "hidden"}>
                  {i.side ?? <p className="text-sm text-slate-600">{sideEmpty}</p>}
                </div>
              ))}
            </Pane>
          }
        />
      ) : (
        work
      )}
      {footer}
    </div>
  );
}
