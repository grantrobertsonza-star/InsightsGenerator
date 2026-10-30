// R6 CSM extension: the one reading of a CSM statistic from a Cross tab question the engine computed
// (computeCrosstab, excludeDk false, so every answer code comes back as a row with its unrounded weighted count
// and its unweighted count). Pure. The contract is claude/csm-extension.md ("Metric definitions").
//
// Every statistic has an explicit domain of valid codes; the base is the weighted count of answers inside it.
// Codes outside the domain are never in the base: labelled non-answers (99 Do not know, 98 Not applicable) are
// counted as nonresponse and disclosed; any other code outside the domain is counted apart and disclosed.
// Blank answers are structural skips and never reach the table. A pending outcome (code 9 on an outcome
// question) is an answer, never missing: it is in the domain of the outcome distribution and outside the
// domain of known-outcome completion, which is its own derived field (journey_completed, blank when pending).
//   t2b   share of 4 and 5 among valid 1 to 5 (satisfaction top two; on an agreement scale, Agree or Strongly agree)
//   top   share of 5 among valid 1 to 5;   b2b  share of 1 and 2 among valid 1 to 5
//   mean5 mean of valid 1 to 5;  mean7 mean of valid 1 to 7;  ease  share of 6 and 7 among valid 1 to 7
//   nps   share of 9 and 10 minus share of 0 to 6 among valid 0 to 10 (passives in the base), in points
//   risk  share of 8 to 10 among valid 0 to 10 (switching likelihood; higher is worse)
//   yes   share of 1 among valid 0 and 1
//   mean_gap  mean of valid -4 to 4 (a paired within-person difference of two 1 to 5 ratings), in scale points
//   distN share of code N among valid 1 to 5 (a full distribution adds to 100 over the valid ratings)
// Shares are percentages of the weighted base; means are in the scale's own points. Figures are unrounded.
import { computeCrosstab } from "./crosstabs";
import { isNonAnswerLabel } from "./nonAnswerLabel";
import type { CrosstabFilter, CrosstabResult, CrosstabRow } from "./parseStatsFile";
import { smallBaseLevel } from "./trackerAudience";

export type CsmStatistic = "t2b" | "top" | "b2b" | "mean5" | "mean7" | "ease" | "nps" | "risk" | "yes" | "mean_gap" | "dist1" | "dist2" | "dist3" | "dist4" | "dist5";

type Domain = { lo: number; hi: number };
const DOMAIN: Record<CsmStatistic, Domain> = {
  t2b: { lo: 1, hi: 5 }, top: { lo: 1, hi: 5 }, b2b: { lo: 1, hi: 5 }, mean5: { lo: 1, hi: 5 },
  dist1: { lo: 1, hi: 5 }, dist2: { lo: 1, hi: 5 }, dist3: { lo: 1, hi: 5 }, dist4: { lo: 1, hi: 5 }, dist5: { lo: 1, hi: 5 },
  mean7: { lo: 1, hi: 7 }, ease: { lo: 1, hi: 7 },
  nps: { lo: 0, hi: 10 }, risk: { lo: 0, hi: 10 },
  yes: { lo: 0, hi: 1 },
  mean_gap: { lo: -4, hi: 4 },
};

/** The statistic's unit: a percentage of the valid base, points of a score, or the scale's own points. */
export const STATISTIC_UNIT: Record<CsmStatistic, "percent" | "score" | "scale points"> = {
  t2b: "percent", top: "percent", b2b: "percent", ease: "percent", risk: "percent", yes: "percent",
  dist1: "percent", dist2: "percent", dist3: "percent", dist4: "percent", dist5: "percent",
  nps: "score", mean5: "scale points", mean7: "scale points", mean_gap: "scale points",
};

/** One statistic read from one column of a question. value null: no valid answer, or the engine withheld a count. */
export type CsmReading = {
  statistic: CsmStatistic;
  value: number | null;
  /** The weighted numerator of a share (the weighted sum of codes for a mean). */
  numerator: number | null;
  weightedBase: number;
  rawBase: number;
  /** Unweighted answers labelled as non-answers (don't know, not applicable): excluded and disclosed. */
  nonresponse: number;
  /** Unweighted answers with any other code outside the statistic's domain: excluded and disclosed. */
  outsideDomain: number;
  /** The pack's low-base rule by the raw valid base: below 50 flagged, below 30 descriptive only. */
  baseLevel: "ok" | "small" | "very_small";
  reason?: string;
};

/** Which column of the table a figure is read from: the Total column, or banner column j. */
export type ColumnRef = "total" | number;

/** One answer code's unrounded weighted count and unweighted count in a column. */
export type CodeCount = { code: string; label: string; weighted: number | null; raw: number | null };

export function codeCounts(question: CrosstabResult["questions"][number], column: ColumnRef): CodeCount[] {
  const out: CodeCount[] = [];
  for (const row of question.rows) {
    if (row.isBase || row.isNet || row.isMean || row.isScore || row.rawCode === undefined || row.rawCode === null) continue;
    out.push({ code: row.rawCode, label: row.label, weighted: weightedOf(row, column), raw: rawOf(row, column) });
  }
  return out;
}

function weightedOf(row: CrosstabRow, column: ColumnRef): number | null {
  if (column === "total") {
    const t = row.total as { countExact?: number | null; count?: number | null } | undefined;
    if (!t) return row.countExact?.[0] ?? row.count[0] ?? null;
    return t.countExact !== undefined ? (t.countExact ?? null) : (t.count ?? null);
  }
  return row.countExact !== undefined ? (row.countExact[column] ?? null) : (row.count[column] ?? null);
}

function rawOf(row: CrosstabRow, column: ColumnRef): number | null {
  if (column === "total") {
    const t = row.total as { nCell?: number | null } | undefined;
    if (!t) return row.nCell?.[0] ?? null;
    return t.nCell ?? null;
  }
  return row.nCell?.[column] ?? null;
}

type Question = CrosstabResult["questions"][number];

/**
 * The answer codes of one question, or of several questions summed code by code (the latest experiences of the four
 * channel blocks of a combined file pooled into one all-channel figure: each block is its own experience, so their
 * counts add; a person who used several channels counts once per channel, as in a Channel file).
 */
function countsOf(question: Question | Question[], column: ColumnRef): CodeCount[] {
  const qs = Array.isArray(question) ? question : [question];
  const byCode = new Map<string, CodeCount>();
  for (const q of qs) {
    for (const c of codeCounts(q, column)) {
      const x = byCode.get(c.code);
      if (!x) byCode.set(c.code, { ...c });
      else byCode.set(c.code, { ...x, weighted: x.weighted === null || c.weighted === null ? null : x.weighted + c.weighted, raw: x.raw === null || c.raw === null ? null : x.raw + c.raw });
    }
  }
  return [...byCode.values()];
}

const NUMERATOR: Partial<Record<CsmStatistic, (c: number) => number>> = {
  t2b: (c) => (c >= 4 ? 1 : 0),
  top: (c) => (c === 5 ? 1 : 0),
  b2b: (c) => (c <= 2 ? 1 : 0),
  ease: (c) => (c >= 6 ? 1 : 0),
  risk: (c) => (c >= 8 ? 1 : 0),
  yes: (c) => (c === 1 ? 1 : 0),
  nps: (c) => (c >= 9 ? 1 : c <= 6 ? -1 : 0),
};

/** The statistic of one question in one column. Pure. */
export function readStatistic(question: Question | Question[], column: ColumnRef, statistic: CsmStatistic): CsmReading {
  const domain = DOMAIN[statistic];
  let w = 0;
  let num = 0;
  let raw = 0;
  let nonresponse = 0;
  let outside = 0;
  let withheld = false;
  for (const c of countsOf(question, column)) {
    const code = Number(c.code);
    const inDomain = c.code.trim() !== "" && Number.isInteger(code) && code >= domain.lo && code <= domain.hi;
    if (!inDomain) {
      if (isNonAnswerLabel(c.label)) nonresponse += c.raw ?? 0;
      else outside += c.raw ?? 0;
      continue;
    }
    if (c.weighted === null || c.raw === null) {
      withheld = true;
      continue;
    }
    w += c.weighted;
    raw += c.raw;
    if (statistic.startsWith("mean")) num += code * c.weighted;
    else if (statistic.startsWith("dist")) num += code === Number(statistic.slice(4)) ? c.weighted : 0;
    else num += NUMERATOR[statistic]!(code) * c.weighted;
  }
  const base = { statistic, weightedBase: w, rawBase: raw, nonresponse, outsideDomain: outside, baseLevel: smallBaseLevel(raw) };
  if (withheld) return { ...base, value: null, numerator: null, reason: "The engine withheld a count in this column (a base below its display minimum)." };
  if (!(w > 0)) return { ...base, value: null, numerator: null, reason: "No valid answers in this group." };
  const value = statistic.startsWith("mean") ? num / w : (num / w) * 100;
  return { ...base, value, numerator: num };
}

/** The share of each listed code among the answers with those codes (an outcome or answer distribution whose
 * domain is the listed codes, so a pending code listed is in the base). Pure. */
export function readDistribution(question: Question | Question[], column: ColumnRef, codes: string[]): { rows: { code: string; label: string; share: number | null; weighted: number; raw: number }[]; weightedBase: number; rawBase: number; nonresponse: number; outsideDomain: number; baseLevel: "ok" | "small" | "very_small" } {
  const counts = countsOf(question, column);
  const inList = counts.filter((c) => codes.includes(c.code));
  const weightedBase = inList.reduce((s, c) => s + (c.weighted ?? 0), 0);
  const rawBase = inList.reduce((s, c) => s + (c.raw ?? 0), 0);
  const others = counts.filter((c) => !codes.includes(c.code));
  return {
    rows: codes.map((code) => {
      const c = counts.find((x) => x.code === code);
      const weighted = c?.weighted ?? 0;
      return { code, label: c?.label ?? code, share: weightedBase > 0 ? (weighted / weightedBase) * 100 : null, weighted, raw: c?.raw ?? 0 };
    }),
    weightedBase,
    rawBase,
    nonresponse: others.filter((c) => isNonAnswerLabel(c.label)).reduce((s, c) => s + (c.raw ?? 0), 0),
    outsideDomain: others.filter((c) => !isNonAnswerLabel(c.label)).reduce((s, c) => s + (c.raw ?? 0), 0),
    baseLevel: smallBaseLevel(rawBase),
  };
}

/** The question for one variable in a computed table (by its row item key), or null when the engine skipped it. */
export function questionOf(result: CrosstabResult, variable: string): CrosstabResult["questions"][number] | null {
  return result.questions.find((q) => q.key === variable) ?? null;
}

/** Why a variable has no question in a computed table: the engine's own skip reason when it gave one. */
export function skippedReason(result: CrosstabResult & { skipped?: { variable: string; reason: string }[] }, variable: string): string {
  const s = result.skipped?.find((x) => x.variable === variable);
  return s ? `${variable} could not be tabulated: ${s.reason}` : `${variable} was not in the computed table.`;
}

/** The weighted mean of a count tabulated by its values (contacts on one task: every whole number from `lo` up is
 * valid; non-answer labels and other codes are disclosed, never in the base). Pure. */
export function readCountMean(question: CrosstabResult["questions"][number], column: ColumnRef, lo = 1): { value: number | null; weightedBase: number; rawBase: number; nonresponse: number; outsideDomain: number; baseLevel: "ok" | "small" | "very_small" } {
  let w = 0;
  let num = 0;
  let raw = 0;
  let nonresponse = 0;
  let outside = 0;
  for (const c of codeCounts(question, column)) {
    const n = Number(c.code);
    if (isNonAnswerLabel(c.label)) {
      nonresponse += c.raw ?? 0;
      continue;
    }
    if (!Number.isInteger(n) || n < lo || c.weighted === null) {
      outside += c.raw ?? 0;
      continue;
    }
    w += c.weighted;
    num += n * c.weighted;
    raw += c.raw ?? 0;
  }
  return { value: w > 0 ? num / w : null, weightedBase: w, rawBase: raw, nonresponse, outsideDomain: outside, baseLevel: smallBaseLevel(raw) };
}

// ---- Computing the tables ---------------------------------------------------------------------------------------

/** A filter selecting one raw answer code (a numeric code, matched on the value as stored, never by label). */
export function codeFilter(variable: string, code: string | number): CrosstabFilter {
  const n = Number(code);
  if (!Number.isFinite(n)) throw new Error(`Answer code ${String(code)} of ${variable} is not a numeric code, so it cannot select respondents.`);
  return { variable, op: "between", min: n, max: n };
}
/** A filter selecting a range of raw values, both ends included. */
export const rangeFilter = (variable: string, min: number, max: number): CrosstabFilter => ({ variable, op: "between", min, max });

/** The engine refuses a filter nobody meets: that is an empty population (Not measured), not a failure. */
export class EmptyPopulation extends Error {}

/**
 * One table computed without saving it: each variable a row item (keyed by its name), the Total column, or one
 * column per answer code of `columnVar`; every answer code kept (excludeDk false) so the statistics above decide
 * their own domains and disclose non-answers.
 */
export async function tabulate(tenantId: string, runId: string, documentId: string, variables: string[], weightVar: string | null, filters: CrosstabFilter[], columnVar: string | null = null): Promise<CrosstabResult> {
  try {
    const { result } = await computeCrosstab(tenantId, runId, documentId, {
      columnVars: columnVar ? [columnVar] : [],
      rowItems: [...new Set(variables)].map((v) => ({ key: v, label: v, vars: [v] })),
      weightVar,
      excludeDk: false,
      meanRows: false,
      filters,
      correction: "none",
    });
    return result;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/No cases satisfy/i.test(m)) throw new EmptyPopulation(m);
    throw e;
  }
}

/** The column of a banner answer code in a computed table, or null. */
export function columnOf(result: CrosstabResult, variable: string, code: string): number | null {
  const i = result.columns.findIndex((c) => c.var === variable && c.rawCode === code);
  return i >= 0 ? i : null;
}

// ---- Figures as the screens and exports carry them ---------------------------------------------------------------

/** One figure: computed, Not measured (the construct, its population or the evidence is absent), or failed. */
export type CsmFigure =
  | { id: string; label: string; definition: string; status: "ok"; variable: string; reading: CsmReading }
  | { id: string; label: string; definition: string; status: "not_measured"; reason: string }
  | { id: string; label: string; definition: string; status: "failed"; error: string };

export type CsmDistribution =
  | ({ id: string; label: string; definition: string; status: "ok"; variable: string } & ReturnType<typeof readDistribution>)
  | { id: string; label: string; definition: string; status: "not_measured"; reason: string }
  | { id: string; label: string; definition: string; status: "failed"; error: string };

type FieldLike = { status: "found"; variable: string } | { status: "not_measured"; reason: string };
type Meta = { id: string; label: string; definition: string };

/** A figure read from a computed table (or the reason it is not). `table` is the table or why there is none. */
export function figureOf(meta: Meta, field: FieldLike, table: CrosstabResult | { notMeasured: string } | { failed: string }, statistic: CsmStatistic, column: ColumnRef = "total"): CsmFigure {
  if (field.status !== "found") return { ...meta, status: "not_measured", reason: field.reason };
  if ("notMeasured" in table) return { ...meta, status: "not_measured", reason: table.notMeasured };
  if ("failed" in table) return { ...meta, status: "failed", error: table.failed };
  const q = questionOf(table, field.variable);
  if (!q) return { ...meta, status: "failed", error: skippedReason(table, field.variable) };
  return { ...meta, status: "ok", variable: field.variable, reading: readStatistic(q, column, statistic) };
}

/** An answer distribution over listed codes (null: every declared answer that is not a non-answer). */
export function distributionOf(meta: Meta, field: FieldLike & { answers?: { code: string; label: string }[] }, table: CrosstabResult | { notMeasured: string } | { failed: string }, codes: string[] | null, column: ColumnRef = "total"): CsmDistribution {
  if (field.status !== "found") return { ...meta, status: "not_measured", reason: field.reason };
  if ("notMeasured" in table) return { ...meta, status: "not_measured", reason: table.notMeasured };
  if ("failed" in table) return { ...meta, status: "failed", error: table.failed };
  const q = questionOf(table, field.variable);
  if (!q) return { ...meta, status: "failed", error: skippedReason(table, field.variable) };
  const list = codes ?? (field.answers ?? []).filter((a) => !isNonAnswerLabel(a.label)).map((a) => a.code);
  return { ...meta, status: "ok", variable: field.variable, ...readDistribution(q, column, list) };
}

/** Runs a table, turning an empty population into Not measured and any other error into a stated failure. */
export async function tableOrReason(run: () => Promise<CrosstabResult>, emptyText: string): Promise<CrosstabResult | { notMeasured: string } | { failed: string }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof EmptyPopulation) return { notMeasured: `${emptyText} (${e.message})` };
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}
