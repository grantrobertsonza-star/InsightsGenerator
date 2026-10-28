// CT5K-F01 (Codex, 28 October 2026; batch 59): a figure derived from a table's shares or counts (NPS,
// top-box, a coded mean, the export's Total line, the ranking gap of a finding) is computed from the
// engine's unrounded figures and rounded once at the end. Adding or subtracting the one-decimal display
// values instead shifts the result: seven detractor points of 4.54% each display as 4.5%, so the
// detractors read 31.5% from the displayed parts against 31.78% exact (31.8%), and an NPS built from
// such parts is off by several tenths. With weights of 1/1024 the displayed counts can all be 0.
//
// The engine writes pctExact and countExact next to pct and count from engine 2026.10.28 (TABLE_METHOD
// "2026.10.28"). A table saved before then has only the rounded figures; it is already reported as built
// with an earlier method (tableMethodStatus, a badge, a finding note, support reason method_changed), so
// for it these readers return the rounded figure, the same arithmetic as before, until it is rebuilt.
// A suppressed or empty cell stays null, never 0.
import type { CrosstabRow } from "./parseStatsFile";

type Exact = number | null | undefined;

const pick = (exactList: Exact[] | undefined, rounded: (number | null)[], j: number): number | null => {
  if (exactList !== undefined) return exactList[j] ?? null;
  return rounded[j] ?? null;
};

/** Column j's percentage (or mean on a mean row), unrounded when the table carries it. */
export function exactPct(row: CrosstabRow, j: number): number | null {
  return pick(row.pctExact, row.pct, j);
}

/** The Total column's percentage (or mean), unrounded when the table carries it. */
export function exactTotalPct(row: CrosstabRow): number | null {
  return row.total.pctExact !== undefined ? row.total.pctExact : row.total.pct;
}

/** Column j's weighted count, unrounded when the table carries it. */
export function exactCount(row: CrosstabRow, j: number): number | null {
  return pick(row.countExact, row.count, j);
}

/** The Total column's weighted count, unrounded when the table carries it. */
export function exactTotalCount(row: CrosstabRow): number | null {
  return row.total.countExact !== undefined ? row.total.countExact : row.total.count;
}

/** A banner's NET column percentage or count, unrounded when the table carries it. */
export function exactNetPct(cell: NonNullable<CrosstabRow["net"]>[number]): number | null {
  return cell.pctExact !== undefined ? cell.pctExact : cell.pct;
}
export function exactNetCount(cell: NonNullable<CrosstabRow["net"]>[number]): number | null {
  return cell.countExact !== undefined ? cell.countExact : cell.count;
}

/** Column j's standard error (percentage points), unrounded when the table carries it. */
export function exactSe(row: CrosstabRow, j: number): number | null {
  if (row.seExact !== undefined) return row.seExact[j] ?? null;
  return row.se?.[j] ?? null;
}

/** The one rounding step for a derived share, count or mean shown to one decimal. */
export const roundOnce = (x: number) => Math.round(x * 10) / 10;
