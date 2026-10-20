"use client";

import type { CrosstabFilter, VariableDictionary } from "@/lib/parseStatsFile";
import FilterBuilder from "./CrosstabFilters";

/** What each cell of a table can show. Mirrors the "Show in each cell" ticks on a table. */
export type CellPrefs = { col: boolean; row: boolean; n: boolean; count: boolean; letters: boolean; residual: boolean };
export const DEFAULT_CELLS: CellPrefs = { col: true, row: false, n: true, count: false, letters: true, residual: false };

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

/**
 * The SPSS-style option cards of the workspace: Filter, Cell display and Statistics.
 * They apply to the next table added; each table can still be changed afterwards.
 */
export default function CrosstabOptions({
  runId,
  documentId,
  dict,
  weighted,
  filters,
  setFilters,
  cells,
  setCells,
  net,
  setNet,
  stats,
  setStats,
  layerVar,
  setLayerVar,
  part = "all",
}: {
  runId: string;
  documentId: string;
  dict: VariableDictionary;
  weighted: boolean;
  filters: CrosstabFilter[];
  setFilters: (f: CrosstabFilter[]) => void;
  cells: CellPrefs;
  setCells: React.Dispatch<React.SetStateAction<CellPrefs>>;
  net: boolean;
  setNet: (v: boolean) => void;
  stats: StatPrefs;
  setStats: React.Dispatch<React.SetStateAction<StatPrefs>>;
  layerVar: string;
  setLayerVar: (v: string) => void;
  /**
   * Which group of options to show (Grant's review, 2026-10-20: separate sections in the workspace):
   * "filters" (Filter and Layer), "display" (Cell display and Statistics), or "all" as before.
   */
  part?: "filters" | "display" | "all";
}) {
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
  return (
    <div className="space-y-2">
      {part !== "display" && (
      <div className="rounded-lg border border-border p-2">
        <p className="mb-1 text-xs font-semibold text-foreground">Filter</p>
        <p className="mb-1 text-[11px] text-muted">Limit the table to some cases, for example gender is Female and age from 24 to 36. All filters must hold.</p>
        <FilterBuilder runId={runId} documentId={documentId} dict={dict} value={filters} onChange={setFilters} />
      </div>
      )}
      {part !== "filters" && (
      <div className="rounded-lg border border-border p-2">
        <p className="mb-1 text-xs font-semibold text-foreground">Cell display</p>
        <div className="grid grid-cols-2 gap-x-3">
          {tickBox("n", "Count (cases)", "Unweighted number of cases in the cell")}
          {tickBox("col", "Column %", "Percentage within each column")}
          {tickBox("count", "Weighted count", weighted ? "Weighted number in the cell" : "Only on weighted tables", !weighted)}
          {tickBox("letters", "Column comparisons", "Letters of the columns a cell is significantly higher than")}
          {tickBox("row", "Row %", "Percentage within each row")}
          {tickBox("residual", "Standardized residual", "How far the cell's count sits from what independence would predict, in SPSS's (observed minus expected) over square root of expected. Needs a banner variable.")}
          <label className="flex items-center gap-2 py-0.5 text-xs" title="Adds a NET column after each banner variable">
            <input type="checkbox" checked={net} onChange={(e) => setNet(e.target.checked)} />
            NET column per banner
          </label>
        </div>
        <p className="mt-1 text-[11px] text-muted">The base rows and a Total row are always shown. These choices apply to tables you add from here; each table can still be changed afterwards.</p>
      </div>
      )}
      {part !== "display" && (
      <div className="rounded-lg border border-border p-2">
        <p className="mb-1 text-xs font-semibold text-foreground">Layer (optional)</p>
        <p className="mb-1 text-[11px] text-muted">
          Break the table out into one subtable per category of a variable, the way SPSS Crosstabs&apos; Layer box does
          (for example: the whole table repeated for each region, each wave, or each store). Adding a table builds one
          saved table per category instead of one combined table.
        </p>
        <select
          value={layerVar}
          onChange={(e) => setLayerVar(e.target.value)}
          className="w-full rounded border border-border px-2 py-1 text-xs"
        >
          <option value="">No layer</option>
          {dict.variables
            .filter((v) => v.nDistinct >= 2 && v.nDistinct <= 12 && !v.inSet)
            .map((v) => (
              <option key={v.name} value={v.name}>
                {v.label || v.name}
              </option>
            ))}
        </select>
      </div>
      )}
      {part !== "filters" && (
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
      )}
    </div>
  );
}
