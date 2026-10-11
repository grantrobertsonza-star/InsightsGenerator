import { matchLabel, type Stance } from "./evidenceStance";
import type { CrosstabResult } from "./parseStatsFile";

/**
 * Checking a stated claim against tables, with no raw data. Pure.
 *
 * Tier a (arithmetic): does the figure the report states match the figure in the
 * table, within rounding?
 * Tier b (re-derived test): from the percentages and bases in the table, does the
 * stated comparison (or level against a threshold) hold, with a 95% interval?
 *
 * The model only points at cells (table, row, column). Every number is read and
 * computed here. Summary tables hide weights and design effects, so a re-derived
 * test is an approximation: where the base is missing or the measure unclear the
 * result is "silent" with the reason, never a guess.
 */

export type Cell = { value: number | null; base: number | null; se: number | null; measure: "percent" | "mean" | "unknown" };
export interface TableView {
  id: string;
  datasetId: string;
  label: string;
  rows: string[];
  cols: string[];
  cell(row: string, col: string): Cell | null;
}

const Z = 1.96;
const MIN_BASE = 30;
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** "43%", "1,250", "12.5 percent" to a number; null when there is none. */
export function parseNumber(x: unknown): { value: number; pct: boolean; decimals: number } | null {
  if (typeof x === "number") return Number.isFinite(x) ? { value: x, pct: false, decimals: decimalsOf(String(x)) } : null;
  if (typeof x !== "string") return null;
  const m = x.replace(/−/g, "-").match(/(-?\d[\d,]*(?:\.\d+)?)\s*(%|percent|per cent)?/i);
  if (!m) return null;
  const clean = m[1].replace(/,/g, "");
  const value = Number(clean);
  if (!Number.isFinite(value)) return null;
  return { value, pct: Boolean(m[2]), decimals: decimalsOf(clean) };
}
function decimalsOf(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

export function fromCrosstab(id: string, datasetId: string, label: string, result: CrosstabResult): TableView {
  const cols = [...result.columns.map((c) => c.name), "Total"];
  const rowMap = new Map<string, { row: CrosstabResult["questions"][number]["rows"][number] }>();
  for (const q of result.questions) {
    for (const r of q.rows) {
      if (r.isBase || r.isEffBase) continue;
      rowMap.set(`${q.label}: ${r.label}`, { row: r });
    }
  }
  return {
    id,
    datasetId,
    label,
    rows: [...rowMap.keys()],
    cols,
    cell(row, col) {
      const r = rowMap.get(row)?.row;
      const k = cols.indexOf(col);
      if (!r || k < 0) return null;
      const total = k === cols.length - 1;
      const value = total ? r.total.pct : r.pct[k];
      const b = total ? r.total.base : r.base[k];
      return {
        value: value ?? null,
        base: b ? b.nEff || b.n : null,
        se: total ? null : (r.se?.[k] ?? null),
        measure: r.isMean || r.isScore ? "mean" : "percent",
      };
    },
  };
}

const BASE_ROW = /^(unweighted |weighted |effective )?(base|n|sample size|total n|number of (respondents|cases))\b/i;

export function fromGeneric(id: string, datasetId: string, label: string, headers: string[], rows: Record<string, unknown>[]): TableView {
  const labelCol = headers[0];
  const cols = headers.slice(1);
  const hintsPercent = /%|percent|per cent|proportion|share/i.test(`${label} ${headers.join(" ")}`);
  const byLabel = new Map<string, Record<string, unknown>>();
  let baseRow: Record<string, unknown> | null = null;
  for (const r of rows) {
    const l = String(r[labelCol] ?? "").trim();
    if (!l) continue;
    if (BASE_ROW.test(l)) {
      baseRow ??= r;
      continue;
    }
    if (!byLabel.has(l)) byLabel.set(l, r);
  }
  return {
    id,
    datasetId,
    label,
    rows: [...byLabel.keys()],
    cols,
    cell(row, col) {
      const r = byLabel.get(row);
      if (!r || !cols.includes(col)) return null;
      const raw = r[col];
      const n = parseNumber(raw);
      if (!n) return { value: null, base: null, se: null, measure: "unknown" };
      const isPct = n.pct || (typeof raw === "number" && hintsPercent && n.value >= 0 && n.value <= 100);
      const b = baseRow ? parseNumber(baseRow[col]) : null;
      return { value: n.value, base: b ? b.value : null, se: null, measure: isPct ? "percent" : "unknown" };
    },
  };
}

export function resolveRow(view: TableView, wanted: string): string | null {
  const full = matchLabel(view.rows, wanted);
  if (full) return full;
  // Crosstab labels read "Question: Answer"; accept the answer alone when it is unique.
  const tails = view.rows.map((r) => r.slice(r.indexOf(": ") + 2));
  const hit = matchLabel(tails, wanted);
  if (!hit) return null;
  const all = view.rows.filter((_, i) => tails[i] === hit);
  return all.length === 1 ? all[0] : null;
}
export const resolveCol = (view: TableView, wanted: string) => matchLabel(view.cols, wanted);

export type Atom =
  | { kind: "level"; row: string; col: string; statedText?: string | null; threshold?: number | null; direction?: "above" | "below" | null }
  | { kind: "comparison"; row: string; colA: string; colB: string; direction: "a_higher" | "b_higher"; claimsSignificant?: boolean | null };

export type CheckResult = {
  tier: "a" | "b";
  check: "locate" | "stated_figure" | "level_vs_threshold" | "two_group_gap";
  stance: Stance;
  summary: string;
  detail: Record<string, unknown>;
};

const silent = (check: CheckResult["check"], summary: string, detail: Record<string, unknown> = {}): CheckResult => ({ tier: check === "locate" || check === "stated_figure" ? "a" : "b", check, stance: "silent", summary, detail });

function se(c: Cell): number | null {
  if (c.se !== null) return c.se;
  if (c.measure === "percent" && c.value !== null && c.base && c.base > 0) {
    const p = Math.min(Math.max(c.value / 100, 0), 1);
    return Math.sqrt((p * (1 - p)) / c.base) * 100;
  }
  return null;
}

export function checkAtom(view: TableView, atom: Atom): CheckResult[] {
  const row = resolveRow(view, atom.row);
  if (!row) return [silent("locate", `No row matching "${atom.row}" in "${view.label}".`)];

  if (atom.kind === "level") {
    const col = resolveCol(view, atom.col);
    if (!col) return [silent("locate", `No column matching "${atom.col}" in "${view.label}".`)];
    const c = view.cell(row, col);
    if (!c || c.value === null) return [silent("locate", `The cell for ${row} / ${col} is empty.`)];
    const out: CheckResult[] = [];
    if (atom.statedText) {
      const s = parseNumber(atom.statedText);
      if (s) {
        const tol = 0.5 * 10 ** -s.decimals + 1e-9;
        const diff = c.value - s.value;
        const ok = Math.abs(diff) <= tol;
        out.push({
          tier: "a",
          check: "stated_figure",
          stance: ok ? "supports" : "against",
          summary: ok
            ? `Stated ${atom.statedText}; the table gives ${round(c.value, Math.max(s.decimals, 1))} for ${row} / ${col}. Matches within rounding.`
            : `Stated ${atom.statedText}; the table gives ${round(c.value, 2)} for ${row} / ${col}, a difference of ${round(diff, 2)}.`,
          detail: { stated: s.value, table: c.value, diff, tolerance: tol },
        });
      }
    }
    if (atom.threshold !== null && atom.threshold !== undefined && atom.direction) {
      const sd = se(c);
      if (sd === null || (c.base !== null && c.base < MIN_BASE)) {
        out.push(silent("level_vs_threshold", `${row} / ${col}: no usable base (or under ${MIN_BASE}) to test against ${atom.threshold}.`));
      } else {
        const lo = c.value - Z * sd;
        const hi = c.value + Z * sd;
        const right = atom.direction === "above" ? lo > atom.threshold : hi < atom.threshold;
        const wrong = atom.direction === "above" ? hi < atom.threshold : lo > atom.threshold;
        const stance: Stance = right ? "supports" : wrong ? "against" : "inconclusive";
        out.push({
          tier: "b",
          check: "level_vs_threshold",
          stance,
          summary: `${row} / ${col}: ${round(c.value)} (95% interval ${round(lo)} to ${round(hi)}) against ${atom.direction} ${atom.threshold}.${stance === "inconclusive" ? " The interval spans the threshold." : ""}`,
          detail: { value: c.value, lo, hi, threshold: atom.threshold, base: c.base },
        });
      }
    }
    if (out.length === 0) out.push({ tier: "a", check: "locate", stance: "silent", summary: `Found ${row} / ${col} = ${round(c.value, 2)}, but the claim gives no figure or threshold to check.`, detail: { table: c.value } });
    return out;
  }

  const a = resolveCol(view, atom.colA);
  const b = resolveCol(view, atom.colB);
  if (!a || !b || a === b) return [silent("locate", `Could not find two distinct columns for "${atom.colA}" and "${atom.colB}" in "${view.label}".`)];
  const ca = view.cell(row, a);
  const cb = view.cell(row, b);
  if (!ca || !cb || ca.value === null || cb.value === null) return [silent("locate", `A cell for ${row} is empty in ${a} or ${b}.`)];
  if (ca.measure !== "percent" || cb.measure !== "percent") {
    return [silent("two_group_gap", `${row}: the figures are not clearly percentages, so a test cannot be re-derived from this table.`, { measureA: ca.measure, measureB: cb.measure })];
  }
  const sa = se(ca);
  const sb = se(cb);
  if (sa === null || sb === null || (ca.base !== null && ca.base < MIN_BASE) || (cb.base !== null && cb.base < MIN_BASE)) {
    return [silent("two_group_gap", `${row}: ${a} ${round(ca.value)} vs ${b} ${round(cb.value)}, but a base is missing or under ${MIN_BASE}, so the gap cannot be tested from this table.`, { baseA: ca.base, baseB: cb.base })];
  }
  const diff = ca.value - cb.value;
  const sd = Math.sqrt(sa ** 2 + sb ** 2);
  const lo = diff - Z * sd;
  const hi = diff + Z * sd;
  const sign = atom.direction === "a_higher" ? 1 : -1;
  const eLo = sign === 1 ? lo : -hi;
  const eHi = sign === 1 ? hi : -lo;
  const stance: Stance = eLo > 0 ? "supports" : eHi < 0 ? "against" : "inconclusive";
  let note = "";
  if (stance === "inconclusive") note = " The interval for the gap includes zero, so the table does not settle it.";
  if (stance !== "supports" && atom.claimsSignificant) note += " The claim says the difference is significant; this re-derived test does not confirm it. Weights and design effects are not visible in a summary table, so this is an approximation.";
  return [
    {
      tier: "b",
      check: "two_group_gap",
      stance,
      summary: `${row}: ${a} ${round(ca.value)} vs ${b} ${round(cb.value)}, gap ${round(diff)} (95% interval ${round(lo)} to ${round(hi)}), claim says ${atom.direction === "a_higher" ? `${a} higher` : `${b} higher`}.${note}`,
      detail: { diff, lo, hi, valueA: ca.value, valueB: cb.value, baseA: ca.base, baseB: cb.base },
    },
  ];
}
