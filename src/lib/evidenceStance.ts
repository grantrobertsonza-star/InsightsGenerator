import type { CrosstabResult, CrosstabRow } from "./parseStatsFile";

/**
 * Reads a table as evidence for or against an objective. Pure: no database, no model.
 *
 * Nothing here needs a significance flag. A result counts as evidence when an
 * estimate and its interval can be set against what the objective expects:
 * a level against a stated threshold, or a gap between two groups against zero
 * (or against a margin that counts as "no meaningful difference", set before
 * the table is read). Intervals are normal approximations from the standard
 * error the engine reports (design based when a design was given), otherwise
 * from the effective base. They are not corrected for the number of questions
 * asked, so a stance is evidence to weigh, not a verdict.
 */

export type Stance = "supports" | "against" | "mixed" | "inconclusive" | "silent";

export type Expectation =
  | {
      kind: "level";
      /** Answer label to read, or null for the question's mean or score row. */
      answer: string | null;
      direction: "above" | "below";
      /** Percent (0 to 100) for a share, or the unit of the mean for an average. */
      threshold: number;
      question?: string | null;
    }
  | {
      kind: "comparison";
      answer: string | null;
      /** higher: group A is expected above group B. lower: below. */
      direction: "higher" | "lower";
      groupA: string;
      groupB: string;
      /** Gap that counts as "no meaningful difference". Optional; set before reading. */
      margin?: number | null;
      question?: string | null;
    };

export type EvidenceEstimate = {
  measure: "percent" | "mean";
  label: string;
  value: number | null;
  lo: number | null;
  hi: number | null;
  n: number | null;
  /** For a comparison: the two groups and the gap A minus B. */
  groupA?: string;
  groupB?: string;
  diff?: number | null;
  diffLo?: number | null;
  diffHi?: number | null;
};

export type Reading = { stance: Stance; estimate: EvidenceEstimate; summary: string };

/** Below this effective base an estimate is too thin to count either way. */
export const MIN_BASE = 30;
const Z = 1.96;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Exact match first, then one label containing the other. Null when nothing fits or two fit equally. */
export function matchLabel(labels: string[], wanted: string): string | null {
  const w = norm(wanted);
  if (!w) return null;
  const exact = labels.filter((l) => norm(l) === w);
  if (exact.length === 1) return exact[0];
  const loose = labels.filter((l) => {
    const n = norm(l);
    return n.length > 0 && (n.includes(w) || w.includes(n));
  });
  return loose.length === 1 ? loose[0] : null;
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

type Cell = { value: number; se: number | null; n: number | null; measure: "percent" | "mean" };

/** One cell of a row as an estimate. col = -1 reads the total column. */
function cell(row: CrosstabRow, col: number): Cell | null {
  const measure: "percent" | "mean" = row.isMean || row.isScore ? "mean" : "percent";
  const value = col < 0 ? row.total.pct : row.pct[col];
  if (value === null || value === undefined) return null;
  const base = col < 0 ? row.total.base : row.base[col];
  const n = base ? base.nEff || base.n : null;
  let se: number | null = col < 0 ? null : (row.se?.[col] ?? null);
  if (col < 0 && measure === "mean" && row.desc?.sem != null) se = row.desc.sem;
  if (se === null && measure === "percent" && n && n > 0) {
    const p = Math.min(Math.max(value / 100, 0), 1);
    se = Math.sqrt((p * (1 - p)) / n) * 100;
  }
  return { value, se, n, measure };
}

function interval(c: Cell): { lo: number | null; hi: number | null } {
  if (c.se === null) return { lo: null, hi: null };
  let lo = c.value - Z * c.se;
  let hi = c.value + Z * c.se;
  if (c.measure === "percent") {
    lo = Math.max(0, lo);
    hi = Math.min(100, hi);
  }
  return { lo: round(lo), hi: round(hi) };
}

/** The row an expectation points at, or null when the table has no such row. */
export function locateRow(result: CrosstabResult, answer: string | null, question?: string | null): CrosstabRow | null {
  let qs = result.questions;
  if (question) {
    const qLabel = matchLabel(qs.map((q) => q.label), question);
    if (qLabel) qs = qs.filter((q) => q.label === qLabel);
  }
  for (const q of qs) {
    const rows = q.rows.filter((r) => !r.isBase && !r.isEffBase);
    if (answer === null) {
      const scored = rows.find((r) => r.isMean || r.isScore);
      if (scored) return scored;
      continue;
    }
    const label = matchLabel(rows.map((r) => r.label), answer);
    if (label) return rows.find((r) => r.label === label) ?? null;
  }
  return null;
}

const units = (c: Cell) => (c.measure === "percent" ? "%" : "");
const f = (x: number | null) => (x === null ? "n/a" : String(round(x)));

export function readLevel(result: CrosstabResult, exp: Extract<Expectation, { kind: "level" }>): Reading | null {
  const row = locateRow(result, exp.answer, exp.question);
  if (!row) return null;
  const c = cell(row, -1);
  if (!c) return null;
  const { lo, hi } = interval(c);
  const estimate: EvidenceEstimate = { measure: c.measure, label: row.label, value: round(c.value), lo, hi, n: c.n };
  if (c.n !== null && c.n < MIN_BASE) {
    return { stance: "silent", estimate, summary: `${row.label}: base of ${f(c.n)} is too small to read.` };
  }
  const want = exp.direction === "above" ? "above" : "below";
  const u = units(c);
  const head = `${row.label}: ${f(estimate.value)}${u}${lo !== null ? ` (95% interval ${f(lo)} to ${f(hi)})` : ""} against ${want} ${exp.threshold}${u}.`;
  if (lo === null || hi === null) return { stance: "inconclusive", estimate, summary: `${head} No interval available.` };
  const right = exp.direction === "above" ? lo > exp.threshold : hi < exp.threshold;
  const wrong = exp.direction === "above" ? hi < exp.threshold : lo > exp.threshold;
  const stance: Stance = right ? "supports" : wrong ? "against" : "inconclusive";
  return { stance, estimate, summary: `${head} ${stance === "inconclusive" ? "The interval spans the threshold." : ""}`.trim() };
}

export function readComparison(result: CrosstabResult, exp: Extract<Expectation, { kind: "comparison" }>): Reading | null {
  const row = locateRow(result, exp.answer, exp.question);
  if (!row) return null;
  const names = result.columns.map((c) => c.name);
  const a = matchLabel(names, exp.groupA);
  const b = matchLabel(names, exp.groupB);
  if (!a || !b || a === b) return null;
  const ca = cell(row, names.indexOf(a));
  const cb = cell(row, names.indexOf(b));
  if (!ca || !cb) return null;
  const base: EvidenceEstimate = {
    measure: ca.measure,
    label: row.label,
    value: round(ca.value),
    lo: interval(ca).lo,
    hi: interval(ca).hi,
    n: ca.n,
    groupA: a,
    groupB: b,
  };
  if ((ca.n !== null && ca.n < MIN_BASE) || (cb.n !== null && cb.n < MIN_BASE)) {
    return { stance: "silent", estimate: base, summary: `${row.label}: one of the groups has a base under ${MIN_BASE}, too small to compare.` };
  }
  const diff = ca.value - cb.value;
  const u = units(ca);
  base.diff = round(diff);
  if (ca.se === null || cb.se === null) {
    return { stance: "inconclusive", estimate: base, summary: `${row.label}: ${a} ${f(ca.value)}${u} vs ${b} ${f(cb.value)}${u}. No interval available.` };
  }
  const se = Math.sqrt(ca.se ** 2 + cb.se ** 2);
  const lo = diff - Z * se;
  const hi = diff + Z * se;
  base.diffLo = round(lo);
  base.diffHi = round(hi);
  const sign = exp.direction === "higher" ? 1 : -1;
  const sLo = sign === 1 ? lo : -hi; // interval of the gap in the expected direction
  const sHi = sign === 1 ? hi : -lo;
  const margin = exp.margin && exp.margin > 0 ? exp.margin : null;
  let stance: Stance;
  if (sLo > 0) stance = "supports";
  else if (sHi < 0) stance = "against";
  else if (margin !== null && lo > -margin && hi < margin) stance = "against";
  else stance = "inconclusive";
  const note =
    stance === "inconclusive"
      ? "The interval for the gap includes zero, so this does not settle it either way."
      : stance === "against" && sHi >= 0
        ? `The gap is within the ${margin}-point margin set for no meaningful difference.`
        : "";
  return {
    stance,
    estimate: base,
    summary: `${row.label}: ${a} ${f(ca.value)}${u} vs ${b} ${f(cb.value)}${u}, gap ${f(diff)} (95% interval ${f(lo)} to ${f(hi)}), expected ${exp.direction}. ${note}`.trim(),
  };
}

export function readExpectation(result: CrosstabResult, exp: Expectation): Reading | null {
  return exp.kind === "level" ? readLevel(result, exp) : readComparison(result, exp);
}

/** Several readings (or several questions under one objective) into one stance. */
export function combineStances(stances: Stance[]): Stance {
  if (stances.length === 0) return "silent";
  const has = (s: Stance) => stances.includes(s);
  if (has("supports") && has("against")) return "mixed";
  if (has("mixed")) return "mixed";
  if (has("supports")) return "supports";
  if (has("against")) return "against";
  if (has("inconclusive")) return "inconclusive";
  return "silent";
}

/** Checks a stored expectation has the fields needed, so a bad one falls back to a model judgement. */
export function parseExpectation(raw: unknown): Expectation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const question = str(r.question);
  const answer = str(r.answer);
  if (r.kind === "level") {
    const threshold = num(r.threshold);
    if (threshold === null || (r.direction !== "above" && r.direction !== "below")) return null;
    return { kind: "level", answer, direction: r.direction, threshold, question };
  }
  if (r.kind === "comparison") {
    const a = str(r.groupA);
    const b = str(r.groupB);
    if (!a || !b || (r.direction !== "higher" && r.direction !== "lower")) return null;
    return { kind: "comparison", answer, direction: r.direction, groupA: a, groupB: b, margin: num(r.margin), question };
  }
  return null;
}
