import { pearsonCorrelation as pearsonWithTest } from "./stats";

/**
 * Pure helpers for the Analytics scatter plot (Grant, 2026-10-20). No file access here: the paired
 * values come from scatterActions.ts, read the same way driver analysis reads its columns.
 */

/**
 * Pearson correlation between two numeric variables over complete cases. With weights it is the
 * weighted correlation: weighted means, weighted covariance over the product of weighted standard
 * deviations. The weights' overall scale cancels out (multiplying every weight by the same constant
 * leaves r unchanged), so a weighting convention cannot change the figure. `n` is the number of
 * cases that entered (every value finite, and a finite positive weight when weighted), not the sum
 * of weights. Null when fewer than 3 cases enter or either variable does not vary, as r is then
 * undefined or meaningless.
 */
export function pearsonCorrelation(xs: readonly number[], ys: readonly number[], ws?: readonly number[] | null): { r: number; n: number } | null {
  const idx: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const w = ws ? ws[i] : 1;
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i]) && Number.isFinite(w) && w > 0) idx.push(i);
  }
  if (idx.length < 3) return null;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (const i of idx) {
    const w = ws ? ws[i] : 1;
    sw += w;
    sx += w * xs[i];
    sy += w * ys[i];
  }
  const mx = sx / sw;
  const my = sy / sw;
  let cxy = 0;
  let cxx = 0;
  let cyy = 0;
  for (const i of idx) {
    const w = ws ? ws[i] : 1;
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cxy += w * dx * dy;
    cxx += w * dx * dx;
    cyy += w * dy * dy;
  }
  if (!(cxx > 0) || !(cyy > 0)) return null;
  const r = cxy / Math.sqrt(cxx * cyy);
  return { r: Math.max(-1, Math.min(1, r)), n: idx.length };
}

/**
 * At most `cap` items, taken at an even stride through the list so the drawn points span the whole
 * file rather than its first rows; deterministic, so the same file always draws the same points.
 * The correlation is computed on every complete case, never on this sample.
 */
export function capByStride<T>(items: readonly T[], cap: number): T[] {
  if (items.length <= cap) return [...items];
  const out: T[] = [];
  const step = items.length / cap;
  for (let k = 0; k < cap; k++) out.push(items[Math.floor(k * step)]);
  return out;
}

/**
 * A small deterministic offset in [-0.5, 0.5) for point i, used only to spread points that sit on
 * the same spot on a short answer scale. Display only: the values themselves are never changed.
 */
export function jitterOffset(i: number, axis: 0 | 1): number {
  const s = Math.sin((i + 1) * (axis === 0 ? 12.9898 : 78.233)) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/** The most points kept on a posted finding, as the table engine keeps for its relationship findings. */
export const FINDING_POINTS = 300;

export type ScatterFindingInput = {
  x: { name: string; label: string };
  y: { name: string; label: string };
  /** Complete cases only (both values finite, and a finite positive weight when weighted). */
  xs: readonly number[];
  ys: readonly number[];
  ws: readonly number[] | null;
  weightVar: string | null;
  casesInFile: number;
};

const formatP = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p}`);

/**
 * The finding a scatter's correlation is posted as (pattern "relationship", drawn as a scatter by
 * findingsChartData.ts), built from complete cases the server read itself. Unweighted, r and its
 * p-value are the shared test in stats.ts (t on n - 2 degrees of freedom), so the figure matches the
 * relationships the table engine finds. Weighted, r is the weighted correlation above, rounded the same
 * way, with no p-value: a test that counted the weighted cases as independent observations would
 * overstate the certainty, so none is given and the finding says so. Null when r is undefined.
 */
export function scatterFinding(input: ScatterFindingInput): { text: string; theme: string; statedStats: Record<string, unknown> } | null {
  const n = input.xs.length;
  let r: number;
  let pValue: number | null = null;
  if (input.ws) {
    const w = pearsonCorrelation(input.xs, input.ys, input.ws);
    if (!w) return null;
    r = Math.round(w.r * 100) / 100;
  } else {
    if (n < 3) return null;
    const t = pearsonWithTest([...input.xs], [...input.ys]);
    if (t.r === null || t.r === undefined) return null;
    r = t.r;
    pValue = t.pValue ?? null;
  }
  const weighted = !!input.ws;
  const cases = `Across ${n.toLocaleString("en-GB")} of ${input.casesInFile.toLocaleString("en-GB")} cases (those answering both)`;
  const stat = weighted
    ? `r = ${r} (weighted by ${input.weightVar ?? "the chosen weight"}; no significance test for a weighted correlation)`
    : `r = ${r} (${pValue === null ? "no p-value" : formatP(pValue)}, unweighted)`;
  const text = `${cases}, ${input.x.label} and ${input.y.label} have a Pearson correlation of ${stat}. This describes association, not cause.`;
  const pairs = input.xs.map((x, i) => ({ x, y: input.ys[i] }));
  return {
    text,
    theme: `${input.x.label} & ${input.y.label}`,
    statedStats: {
      source: "scatter_tool",
      variable1: input.x.name,
      variable2: input.y.name,
      label1: input.x.label,
      label2: input.y.label,
      r,
      n,
      casesInFile: input.casesInFile,
      weighted,
      weightVar: input.weightVar,
      pValue,
      pairCount: n,
      // The same {x, y} shape and even stride the table engine stores, so the Findings scatter draws it.
      points: capByStride(pairs, FINDING_POINTS),
      note: "descriptive association only; not evidence of causation",
      caveats: weighted ? ["descriptive_reading", "weighted_no_test"] : ["descriptive_reading"],
    },
  };
}
