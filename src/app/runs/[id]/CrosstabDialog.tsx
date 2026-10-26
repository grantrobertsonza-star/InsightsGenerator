"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CrosstabFilter, CrosstabRowItem, VariableDictionary, VariableInfo } from "@/lib/parseStatsFile";
import FilterBuilder from "./CrosstabFilters";
import { isStringCategory } from "@/lib/variableKinds";

/** What each cell of a table can show. Mirrors the "Show in each cell" ticks on a table. */
export type CellPrefs = { col: boolean; row: boolean; n: boolean; count: boolean; letters: boolean };
export const DEFAULT_CELLS: CellPrefs = { col: true, row: false, n: true, count: false, letters: true };

/** Association measures that can be shown beside the whole-table test. The chi-square is always shown. */
export type StatPrefs = { v: boolean; c: boolean; lambda: boolean; gamma: boolean; tauB: boolean; tauC: boolean; somersD: boolean; eta: boolean };
export const DEFAULT_STATS: StatPrefs = { v: true, c: false, lambda: false, gamma: false, tauB: false, tauC: false, somersD: false, eta: true };
export const STAT_LABELS: { key: keyof StatPrefs; label: string; hint: string }[] = [
  { key: "v", label: "Phi and Cramer's V", hint: "Size of the association from 0 to 1, for any table. Phi for a 2 by 2 table." },
  { key: "c", label: "Contingency coefficient", hint: "Size of the association; its maximum is below 1 and depends on table size." },
  { key: "lambda", label: "Lambda", hint: "Proportional reduction in errors guessing the answer when the banner group is known." },
  { key: "gamma", label: "Gamma", hint: "For ordered answers and ordered groups: concordant against discordant pairs." },
  { key: "tauB", label: "Kendall's tau-b", hint: "For ordered variables, corrected for ties; best for square tables." },
  { key: "tauC", label: "Kendall's tau-c", hint: "For ordered variables, suited to tables that are not square." },
  { key: "somersD", label: "Somers' d", hint: "For ordered variables: the answer treated as depending on the banner group." },
  { key: "eta", label: "Eta (for averages)", hint: "Share of the variation in an average that lies between the banner groups." },
];

type Pick = { key: string; name: string; label: string; isSet: boolean; tag: string; item: CrosstabRowItem };

export type DialogResult = { cols: string[]; rows: CrosstabRowItem[]; cells: CellPrefs; net: boolean; stats: StatPrefs; filters: CrosstabFilter[] };

/**
 * A fixed-layout way to build a table, in the spirit of the SPSS Crosstabs window:
 * pick variables on the left, send them to Rows or Columns, choose what each cell shows, press OK.
 * It only fills in the same choices as the main workspace; nothing here computes anything.
 */
export default function CrosstabDialog({
  runId,
  documentId,
  initialFilters,
  dict,
  weighted,
  initialCols,
  initialRows,
  initialCells,
  initialNet,
  initialStats,
  busy,
  onApply,
  onClose,
  embedded = false,
  controlled,
}: {
  runId: string;
  documentId: string;
  initialFilters: CrosstabFilter[];
  dict: VariableDictionary;
  weighted: boolean;
  initialCols: string[];
  initialRows: CrosstabRowItem[];
  initialCells: CellPrefs;
  initialNet: boolean;
  initialStats: StatPrefs;
  busy: boolean;
  onApply: (r: DialogResult, run: boolean) => void;
  onClose: () => void;
  embedded?: boolean;
  /** Embedded use: the variable list lives outside, and the Columns and Rows are the workspace's own. */
  controlled?: {
    cols: string[];
    setCols: React.Dispatch<React.SetStateAction<string[]>>;
    rows: CrosstabRowItem[];
    setRows: React.Dispatch<React.SetStateAction<CrosstabRowItem[]>>;
  };
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [colsOwn, setColsOwn] = useState<string[]>(initialCols);
  const [rowsOwn, setRowsOwn] = useState<CrosstabRowItem[]>(initialRows.filter((r) => !r.kind || r.kind !== "nets"));
  const cols = controlled ? controlled.cols : colsOwn;
  const setCols = controlled ? controlled.setCols : setColsOwn;
  const rows = controlled ? controlled.rows : rowsOwn;
  const setRows = controlled ? controlled.setRows : setRowsOwn;
  const [cells, setCells] = useState<CellPrefs>(initialCells);
  const [net, setNet] = useState(initialNet);
  const [stats, setStats] = useState<StatPrefs>(initialStats);
  const [filters, setFilters] = useState<CrosstabFilter[]>(initialFilters);

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, embedded]);

  const picks = useMemo<Pick[]>(() => {
    const out: Pick[] = [];
    const setByKey = new Map((dict.sets ?? []).map((s) => [s.key, s]));
    const seen = new Set<string>();
    for (const v of dict.variables as VariableInfo[]) {
      // Free text and identifiers are left out; a string category (Gender, "Yes"/"No") is offered,
      // by the same shared rule as the crosstab workspace (variableKinds.ts).
      if (v.weightLike || (v.text && !isStringCategory(v))) continue;
      const s = v.inSet ? setByKey.get(v.inSet) : undefined;
      if (s) {
        if (seen.has(s.key)) continue;
        seen.add(s.key);
        const tag = s.kind === "grid" || s.kind === "battery" ? "Grid" : "Multi";
        out.push({
          key: s.key,
          name: s.key,
          label: s.label,
          isSet: true,
          tag,
          item: { key: s.key, label: s.label, stem: s.label, vars: s.vars, kind: s.kind ?? "multi" },
        });
        continue;
      }
      if (v.nDistinct < 2) continue;
      out.push({
        key: v.name,
        name: v.name,
        label: v.label,
        isSet: false,
        tag: v.numeric && !v.labelled ? "Scale" : "Single",
        item: { key: v.name, label: v.label, vars: [v.name] },
      });
    }
    return out;
  }, [dict]);

  const byKey = useMemo(() => new Map(picks.map((p) => [p.key, p])), [picks]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? picks.filter((p) => p.name.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)) : picks).slice(0, 600);
  }, [picks, query]);

  const toggleSel = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const toRows = () => {
    const add = sel.map((k) => byKey.get(k)).filter((p): p is Pick => !!p && !rows.some((r) => r.key === p.key));
    setRows((r) => [...r, ...add.map((p) => p.item)]);
    setSel([]);
  };
  const toCols = () => {
    const add = sel.map((k) => byKey.get(k)).filter((p): p is Pick => !!p && !p.isSet && !cols.includes(p.name));
    setCols((c) => [...c, ...add.map((p) => p.name)]);
    setSel([]);
  };
  const noneTicked = !cells.col && !cells.row && !cells.n && !cells.count;
  // Rows only, or columns only, is allowed: the table then describes all respondents.
  const ready = (cols.length > 0 || rows.length > 0) && !noneTicked;
  const labelOf = (k: string) => byKey.get(k)?.label ?? dict.variables.find((v) => v.name === k)?.label ?? k;
  const tickBox = (key: keyof CellPrefs, label: string, hint?: string, disabled?: boolean) => (
    <label key={key} className={`flex items-center gap-2 py-0.5 text-xs ${disabled ? "opacity-50" : ""}`} title={hint}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={cells[key] && !disabled}
        onChange={(e) => setCells((c) => ({ ...c, [key]: e.target.checked }))}
      />
      {label}
    </label>
  );
  const box = "h-40 shrink-0 overflow-y-auto rounded-lg border border-border bg-white p-1.5 text-xs";
  const arrowBtn =
    "rounded-lg border border-border px-3 py-2 text-sm text-muted hover:border-slate-400 disabled:opacity-40";

  const actions = (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => {
              setRows([]);
              setCols([]);
              setSel([]);
              setCells(DEFAULT_CELLS);
              setNet(true);
              setStats(DEFAULT_STATS);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-slate-400"
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-slate-400">
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => onApply({ cols, rows, cells, net, stats, filters }, false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs hover:border-slate-400 disabled:opacity-50"
              title="Fill the workspace with these choices without building the table yet"
            >
              Paste to workspace
            </button>
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => onApply({ cols, rows, cells, net, stats, filters }, true)}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy ? "Working..." : "OK, add table"}
            </button>
          </div>
        </div>
  );

  const card = (
      <div className={embedded ? "flex w-full flex-col rounded-xl border border-border bg-white" : "flex max-h-full w-full max-w-4xl flex-col rounded-xl border border-border bg-white shadow-xl"}>
        {!embedded && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Crosstabs</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-muted hover:text-foreground">
            ×
          </button>
        </div>
        )}
        <div className={`grid min-h-0 flex-1 gap-3 p-4 ${embedded ? "grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] overflow-y-auto"}`}>
          {!embedded && (<>
          {/* Variable list */}
          <div className={`flex min-w-0 flex-col gap-2 ${embedded ? "h-[36rem]" : "min-h-[20rem]"}`}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or label"
              className="rounded-lg border border-border px-3 py-1.5 text-xs"
              autoFocus
            />
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
              {shown.map((p) => {
                const on = sel.includes(p.key);
                const used = rows.some((r) => r.key === p.key) || cols.includes(p.name);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggleSel(p.key)}
                    onDoubleClick={() => {
                      if (!rows.some((r) => r.key === p.key)) setRows((r) => [...r, p.item]);
                    }}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1 text-left text-xs ${on ? "bg-primary text-white" : used ? "bg-slate-50 text-muted" : "hover:bg-slate-50"}`}
                    title={`${p.name}: ${p.label}`}
                  >
                    <span className={`w-10 shrink-0 text-[10px] ${on ? "text-white/80" : "text-muted"}`}>{p.tag}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{p.name}</span> <span className={on ? "text-white/90" : "text-muted"}>{p.label}</span>
                    </span>
                  </button>
                );
              })}
              {shown.length === 0 && <p className="p-3 text-xs text-muted">No variables match.</p>}
            </div>
            <p className="text-[11px] text-muted">Click to select several, then use the arrows. Double click sends one to Rows.</p>
          </div>

          {/* Arrows: each sits level with the box it fills */}
          <div className="hidden min-w-0 flex-col gap-2 md:flex">
            <div className="h-4" />
            <div className="flex h-40 items-center justify-center">
              <button
                type="button"
                className={arrowBtn}
                onClick={toCols}
                disabled={sel.length === 0 || sel.every((k) => byKey.get(k)?.isSet)}
                title="Send the selected variables to Columns (multiple response sets cannot be columns)"
              >
                ▶
              </button>
            </div>
            <div className="h-4" />
            <div className="flex h-40 items-center justify-center">
              <button type="button" className={arrowBtn} onClick={toRows} disabled={sel.length === 0} title="Send the selected variables to Rows">
                ▶
              </button>
            </div>
          </div>

          </>)}
          {/* Rows, Columns, Cells */}
          <div className="flex min-w-0 flex-col gap-2">
            {embedded && <p className="text-xs text-muted">Pick variables in the list on the left: Column puts one in the banner, Row adds it to the questions.</p>}
            <p className="text-xs font-semibold text-foreground">Columns</p>
            <div className={box}>
              {cols.length === 0 && <span className="text-muted">One or more banner variables, for example province. Leave empty to describe all respondents.</span>}
              {cols.map((n) => (
                <div key={n} className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 hover:bg-slate-50">
                  <span className="truncate" title={labelOf(n)}>{labelOf(n)}</span>
                  <button type="button" aria-label={`Remove ${labelOf(n)}`} onClick={() => setCols((x) => x.filter((y) => y !== n))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold text-foreground">Rows</p>
            <div className={box}>
              {rows.length === 0 && <span className="text-muted">The questions you want to read down the side. Rows only gives frequencies, means and spread for everyone.</span>}
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-2 rounded px-1.5 py-0.5 hover:bg-slate-50">
                  <span className="truncate" title={r.label}>{r.label}</span>
                  <button type="button" aria-label={`Remove ${r.label}`} onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} className="text-muted hover:text-danger">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="mb-1 text-xs font-semibold text-foreground">Filter</p>
              <p className="mb-1 text-[11px] text-muted">Limit the table to some cases, for example gender is Female and age from 24 to 36. All filters must hold.</p>
              <FilterBuilder runId={runId} documentId={documentId} dict={dict} value={filters} onChange={setFilters} />
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="mb-1 text-xs font-semibold text-foreground">Cell display</p>
              <div className="grid grid-cols-2 gap-x-3">
                {tickBox("n", "Count (cases)", "Unweighted number of cases in the cell")}
                {tickBox("col", "Column %", "Percentage within each column")}
                {tickBox("count", "Weighted count", weighted ? "Weighted number in the cell" : "Only on weighted tables", !weighted)}
                {tickBox("letters", "Column comparisons", "Letters of the columns a cell is significantly higher than")}
                {tickBox("row", "Row %", "Percentage within each row")}
                <label className="flex items-center gap-2 py-0.5 text-xs" title="Adds a NET column after each banner variable">
                  <input type="checkbox" checked={net} onChange={(e) => setNet(e.target.checked)} />
                  NET column per banner
                </label>
              </div>
              <p className="mt-1 text-[11px] text-muted">The base rows and a Total row are always shown. These choices apply to tables you add from here; each table can still be changed afterwards.</p>
            </div>
            <div className="rounded-lg border border-border p-2">
              <p className="mb-1 text-xs font-semibold text-foreground">Statistics</p>
              <p className="mb-1 text-[11px] text-muted">The chi-square test is always shown. Tick the sizes of association to show with it.</p>
              <div className="grid grid-cols-2 gap-x-3">
                {STAT_LABELS.map((t) => (
                  <label key={t.key} className="flex items-center gap-2 py-0.5 text-xs" title={t.hint}>
                    <input type="checkbox" checked={stats[t.key]} onChange={(e) => setStats((x) => ({ ...x, [t.key]: e.target.checked }))} />
                    {t.label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted">These need a column variable, so they are skipped for tables of all respondents.</p>
            </div>
            {embedded && actions}
          </div>
        </div>
        {!embedded && actions}
      </div>
  );
  if (embedded) return card;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-label="Crosstabs">
      {card}
    </div>,
    document.body,
  );
}
