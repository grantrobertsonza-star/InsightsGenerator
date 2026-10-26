import type { CrosstabResult, CrosstabRow } from "./parseStatsFile";

/**
 * The wide end of the funnel. Most market research is read as frequencies,
 * means, cross tabs, top-two and bottom-two boxes and an NPS, with little or
 * no significance testing, so a committed table has to give findings even when
 * nothing in it is significant. Everything here is computed from the saved
 * table, in code, with an interval where one can be given:
 *
 *  - level: the most common answers (or the leading options of a multiple response question)
 *  - top_two_box / bottom_two_box: for an ordered scale whose direction can be read from its labels
 *  - nps: for a 0 to 10 question (promoters 9 to 10, detractors 0 to 6)
 *  - mean: an average with its interval
 *  - net / net score rows the researcher built into the table
 *  - no_difference: a question compared across a banner variable where nothing reached significance
 *
 * None of these is a claim of difference, and the text never says one. Whether
 * a finding is worth an insight is decided later, from its basis, its base
 * sizes and whether it bears on an objective; nothing is dropped here for lack of significance.
 */

export type WideFinding = {
  text: string;
  theme: string;
  patternType: "level" | "no_difference";
  stats: Record<string, unknown>;
};

const MIN_BASE = 30;
const Z = 1.96;
const MAX_PER_TABLE = 40;

const round1 = (x: number) => Math.round(x * 10) / 10;
const DK = /don.?t know|dk\b|refus|not applicable|n\/a|prefer not|unsure|none of the above|other \(/i;
const NEGATIVE = /\b(dis\w+|unlikely|unsatisfied|poor|bad|never|unimportant|difficult|not at all|not very|low|worst|negative)\b/i;
const POSITIVE = /\b(agree|satisfied|good|excellent|likely|important|extremely|very|always|often|high|best|positive|easy)\b/i;

function polarity(label: string): "pos" | "neg" | null {
  if (NEGATIVE.test(label)) return "neg";
  if (POSITIVE.test(label)) return "pos";
  return null;
}

export function baseOf(row: CrosstabRow): number | null {
  const b = row.total.base;
  return b ? b.nEff || b.n : null;
}

export function leadingNumber(label: string): number | null {
  const m = label.trim().match(/^(-?\d+(?:\.\d+)?)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Net Promoter Score from a question's valid answer rows (the Total column), if it looks like an 11-point
 * 0 to 10 scale (promoters 9-10, detractors 0-6, passives 7-8). Shared by the automatic descriptive-findings
 * funnel and the discrete NPS tool in Analytics, so both read the same number off the same table.
 */
export function computeNps(
  answers: CrosstabRow[],
  n0: number,
  /** Which column to read each row's percentage from. Defaults to the Total column; pass r.pct[i] to read
   * one banner column instead, so a segmented NPS reuses the exact same promoters/detractors math. */
  pctOf: (r: CrosstabRow) => number | null = (r) => r.total.pct,
  /** ANA-NPS-003: the matching design-based standard error (percentage points) for whichever column
   * pctOf reads, when the table has one. Defaults to "none available", which keeps the plain SRS
   * variance below as the only option - exactly this function's behaviour before this fix. When
   * supplied, it is used to find the average design effect across the categories that actually feed
   * the promoters/detractors difference (0-6 and 9-10; passives 7-8 don't enter that difference), the
   * same averaging-over-cells approach the table's own chi-square test uses server side
   * (api/parse-stats-file.py's dfull), and the SRS variance of the NPS itself is scaled by it. This is
   * an approximation (a single scalar standard in place of the true linearised covariance of the
   * promoter and detractor totals), not a re-derivation of the Taylor series from raw cases - but it
   * is the same order of approximation the codebase already relies on elsewhere, and it is what the
   * exposed per-category design standard errors can actually support without a backend round trip. */
  seOf: (r: CrosstabRow) => number | null = () => null,
  /** ANA-NPS-003: the table's own design-based standard error (percentage points) of the
   * promoters-minus-detractors CONTRAST itself, for whichever column this reading is for -
   * CrosstabResult.questions[i].npsContrastSe.total for the Total column, or .columns[j] for
   * banner column j. Computed server-side (api/parse-stats-file.py) from the per-case d_i =
   * +1/-1/0 indicator via dsg.totals/var_totals, so it already reflects Var(P)+Var(D)-2*Cov(P,D)
   * in one design-based pass. When supplied (not null/undefined), this REPLACES the seOf-based
   * average-design-effect approximation below rather than being combined with it - that
   * approximation cannot recover the promoter/detractor covariance and is what produced a
   * nonzero interval on a fixture whose true design-based NPS variance is zero. Left undefined,
   * behaviour is unchanged from before this fix (the seOf approximation, or plain SRS if seOf
   * also returns null throughout). */
  contrastSe: number | null | undefined = undefined,
): {
  nps: number;
  lo: number;
  hi: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** ANA-NPS-001: true when at least one of the 11 scale points was suppressed (small base) for the
   * column this reading used. The promoters/passives/detractors/nps figures below still exist (a
   * suppressed point is treated as 0 in the arithmetic, the only way to produce a number at all), but
   * they understate whichever side the suppressed point falls on, so callers must treat this reading
   * as unavailable rather than display it - never read a 0-NPS or any derived figure here as real when
   * this is true. */
  suppressed: boolean;
  /** True when the interval below used a real design-based computation (the exact contrast SE when
   * contrastSe was supplied, otherwise the average-design-effect approximation) rather than the
   * plain SRS formula. */
  designBased: boolean;
  /** True specifically when the interval used the EXACT design-based contrast SE (contrastSe was
   * supplied and usable), as opposed to the average-design-effect approximation. False whenever
   * that approximation (or plain SRS) was used instead, even though designBased above is also true
   * for the approximation case. Callers that must distinguish "exact" from "approximate" read this;
   * everything else can keep reading designBased as before. */
  designExact: boolean;
} | null {
  const numbered = answers.map((r) => ({ r, k: leadingNumber(r.label) }));
  const isNps = numbered.length >= 11 && numbered.every((x) => x.k !== null) && numbered.some((x) => x.k === 0) && numbered.some((x) => x.k === 10);
  if (!isNps) return null;
  const suppressed = numbered.some((x) => pctOf(x.r) == null);
  const pct = (lo: number, hi: number) => numbered.filter((x) => (x.k as number) >= lo && (x.k as number) <= hi).reduce((a, x) => a + (pctOf(x.r) ?? 0), 0);
  const prom = pct(9, 10);
  const det = pct(0, 6);
  const passive = pct(7, 8);
  const nps = prom - det;
  const seSrs = Math.sqrt(Math.max(0, (prom / 100 + det / 100 - ((prom - det) / 100) ** 2) / n0)) * 100;
  let se = seSrs;
  let designBased = false;
  let designExact = false;
  if (contrastSe != null && Number.isFinite(contrastSe)) {
    se = contrastSe;
    designBased = true;
    designExact = true;
  } else {
    const deffs: number[] = [];
    for (const { r, k } of numbered) {
      const kk = k as number;
      if (!((kk >= 0 && kk <= 6) || kk === 9 || kk === 10)) continue; // passives don't feed the prom-det difference
      const p = pctOf(r);
      const seDesign = seOf(r);
      if (p == null || seDesign == null) continue;
      const pFrac = p / 100;
      if (pFrac <= 0 || pFrac >= 1) continue; // SRS variance is 0 here, so a design effect ratio is undefined
      const seSrsCat = Math.sqrt((pFrac * (1 - pFrac)) / n0) * 100;
      if (seSrsCat > 0) deffs.push((seDesign / seSrsCat) ** 2);
    }
    const avgDeff = deffs.length ? deffs.reduce((a, b) => a + b, 0) / deffs.length : null;
    se = avgDeff != null ? seSrs * Math.sqrt(avgDeff) : seSrs;
    designBased = avgDeff != null;
  }
  return {
    nps: round1(nps),
    lo: round1(nps - Z * se),
    hi: round1(nps + Z * se),
    promoters: round1(prom),
    passives: round1(passive),
    detractors: round1(det),
    suppressed,
    designBased,
    designExact,
  };
}

/**
 * Normal-approximation interval around a percentage. When the row carries its own standard
 * error (design based when a sampling design was supplied, otherwise the effective-base SRS
 * figure), that is used as-is; only when none is available does this fall back to computing
 * a plain SRS standard error from n, which understates the interval for a clustered design.
 */
function interval(pct: number, n: number, se?: number | null): { lo: number; hi: number } {
  const s = se != null ? se : Math.sqrt((Math.min(Math.max(pct / 100, 0), 1) * (1 - Math.min(Math.max(pct / 100, 0), 1))) / n) * 100;
  return { lo: round1(Math.max(0, pct - Z * s)), hi: round1(Math.min(100, pct + Z * s)) };
}

function weightedNote(result: CrosstabResult): string {
  return result.weightVar ? "weighted" : "unweighted";
}

function common(result: CrosstabResult, qLabel: string, n: number) {
  return {
    question: qLabel,
    n: Math.round(n),
    effectiveBase: Math.round(n),
    weightVar: result.weightVar,
    design: result.notes?.designUsed ?? null,
    engineVersion: result.engine ?? null,
    caveats: ["descriptive_reading", "weighted_effective_base"],
  };
}

/** Descriptive readings of the Total column of each question. */
export function levelFindings(result: CrosstabResult): WideFinding[] {
  const out: WideFinding[] = [];
  const w = weightedNote(result);
  const filterText = result.filters && result.filters.length ? `, among ${result.filters.map((f) => f.text).join(" and ")}` : "";
  // True when this table has no real banner/group variable, so `columns` holds only the
  // synthetic "All respondents" column and a row's own se[0] is the design-aware standard
  // error of that exact same Total-column percentage (not a different column's estimate).
  const singleCol = result.columns.length === 1;
  for (const q of result.questions) {
    const dataRows = q.rows.filter((r) => !r.isBase && !r.isEffBase);
    const answers = dataRows.filter((r) => !r.isNet && !r.isScore && !r.isMean && r.total.pct !== null && r.total.pct !== undefined);

    // Scores and nets the researcher built into the table are readings in their own right.
    for (const r of dataRows.filter((x) => (x.isScore || x.isNet) && x.total.pct !== null && x.total.pct !== undefined)) {
      const n = baseOf(r);
      if (n === null || n < MIN_BASE) continue;
      const v = round1(r.total.pct as number);
      if (r.isScore) {
        out.push({
          text: `${r.label} on ${q.label} is ${v} points (${w}, base ${Math.round(n)}${filterText}).`,
          theme: q.label,
          patternType: "level",
          stats: { ...common(result, q.label, n), testType: "net_score", answer: r.label, value: v },
        });
      } else if (!r.isMean) {
        const ci = interval(v, n, singleCol ? r.se?.[0] : null);
        out.push({
          text: `${r.label} on ${q.label}: ${v}% (95% interval ${ci.lo} to ${ci.hi}; ${w}, base ${Math.round(n)}${filterText}).`,
          theme: q.label,
          patternType: "level",
          stats: { ...common(result, q.label, n), testType: "net", answer: r.label, value: v, lo: ci.lo, hi: ci.hi },
        });
      }
    }

    if (q.kind === "numeric" || q.kind === "grid") {
      for (const r of dataRows.filter((x) => x.isMean && x.desc && x.desc.mean !== null && x.desc.mean !== undefined).slice(0, 6)) {
        const d = r.desc!;
        const n = d.nEff || d.n;
        if (!n || n < MIN_BASE) continue;
        const mean = round1(d.mean as number);
        const ci = d.sem != null ? { lo: round1((d.mean as number) - Z * d.sem), hi: round1((d.mean as number) + Z * d.sem) } : null;
        const what = q.kind === "grid" ? `"${r.label}" on ${q.label}` : q.label;
        out.push({
          text: `The average for ${what} is ${mean}${ci ? ` (95% interval ${ci.lo} to ${ci.hi})` : ""}${d.median != null ? `, median ${round1(d.median)}` : ""} (${w}, base ${Math.round(n)}${filterText}).`,
          theme: q.label,
          patternType: "level",
          stats: { ...common(result, q.label, n), testType: "mean", answer: r.label, value: mean, ...(ci ? { lo: ci.lo, hi: ci.hi } : {}), median: d.median ?? null },
        });
      }
      continue;
    }

    if (answers.length === 0) continue;

    if (q.kind === "multi") {
      // Each option is its own flag variable and can carry its own base
      // (different missingness or eligibility), so the base and interval
      // are read off that option's own row rather than reused from another
      // option's. This check must come before the n0 gate below: n0 is only
      // baseOf(answers[0]) - the FIRST option's base - and gating on it here
      // would let one thin-based option suppress every other option's
      // otherwise valid finding on this same multi question (IMP-013).
      for (const r of [...answers].sort((a, b) => (b.total.pct ?? 0) - (a.total.pct ?? 0)).slice(0, 3)) {
        const n = baseOf(r);
        if (n === null || n < MIN_BASE) continue;
        const v = round1(r.total.pct as number);
        const ci = interval(v, n, singleCol ? r.se?.[0] : null);
        out.push({
          text: `${v}% of respondents chose "${r.label}" on ${q.label} (95% interval ${ci.lo} to ${ci.hi}; ${w}, base ${Math.round(n)}${filterText}).`,
          theme: q.label,
          patternType: "level",
          stats: { ...common(result, q.label, n), testType: "share", answer: r.label, value: v, lo: ci.lo, hi: ci.hi },
        });
      }
      continue;
    }

    const n0 = baseOf(answers[0]);
    if (n0 === null || n0 < MIN_BASE) continue;

    // NPS: a 0 to 10 question. ANA-NPS-003: the table's own exact design-based contrast SE
    // (Total column) is used when the engine computed one for this question - same precedence
    // as npsActions.ts's single-question tool, so the automatic finding and the on-demand
    // reading never disagree about which uncertainty a given table's NPS carries.
    const contrastSe = q.npsContrastSe?.total ?? undefined;
    // ANA-NPS-003 (second counter-review): only trust a row's own `se` as a design-based category
    // standard error when the table's design was actually applied (not merely requested - see
    // parseStatsFile.ts's designApplied comment). Otherwise that `se` is a plain SRS/Kish fallback
    // that would make computeNps() mislabel an abandoned or never-requested design as design-based.
    const designApplied = result.notes?.designApplied === true;
    const nps = computeNps(answers, n0, (r) => r.total.pct, singleCol && designApplied ? (r) => r.se?.[0] ?? null : () => null, contrastSe);
    if (nps && !nps.suppressed) {
      out.push({
        text: `Net Promoter Score on ${q.label} is ${nps.nps} (promoters ${nps.promoters}%, passives ${nps.passives}%, detractors ${nps.detractors}%; 95% interval ${nps.lo} to ${nps.hi}; ${w}, base ${Math.round(n0)}${filterText}).`,
        theme: q.label,
        patternType: "level",
        stats: {
          ...common(result, q.label, n0),
          testType: "nps",
          value: nps.nps,
          lo: nps.lo,
          hi: nps.hi,
          promoters: nps.promoters,
          passives: nps.passives,
          detractors: nps.detractors,
          // ANA-NPS-003: this interval's own uncertainty qualification - whether a cluster
          // design was applied at all, and whether the correction was the exact design-based
          // promoters-minus-detractors contrast SE or the coarser average-design-effect
          // approximation (see computeNps) - used to be computed and then discarded; `design`
          // from common() only says a design was supplied for the table, not what this specific
          // interval did with it. designExact is a statement about which variance CALCULATION
          // ran, not a claim that the interval itself is exact for a finite sample: it still
          // uses the same 1.96 normal-approximation multiplier either way.
          designBased: nps.designBased,
          designExact: nps.designExact,
          // ANA-NPS-003: same qualification npsActions.ts's on-demand NPS tool now persists -
          // this automatic finding reads the identical table, so it carries the identical
          // caveats rather than a committed finding silently knowing less than the same reading
          // would show if read on demand.
          casesMissingDesign: result.notes?.designUsed?.casesMissingDesign ?? null,
          intervalMethod: result.notes?.intervalMethod ?? null,
        },
      });
      continue;
    }
    if (nps) continue; // recognised as an 11-point NPS scale, but suppressed: unavailable, not wrong

    // Ordered scale with a readable direction: top-two and bottom-two box.
    const scale = answers.filter((r) => !DK.test(r.label));
    if (scale.length >= 4 && scale.length <= 7) {
      let topTwo: CrosstabRow[] | null = null;
      let bottomTwo: CrosstabRow[] | null = null;
      let assumption = "";
      const nums = scale.map((r) => leadingNumber(r.label));
      const first = polarity(scale[0].label);
      const last = polarity(scale[scale.length - 1].label);
      if (first === "pos" && last === "neg") {
        topTwo = scale.slice(0, 2);
        bottomTwo = scale.slice(-2);
      } else if (first === "neg" && last === "pos") {
        topTwo = scale.slice(-2);
        bottomTwo = scale.slice(0, 2);
      } else if (nums.every((x) => x !== null) && first === null && last === null) {
        // Numbered answers with no words to say which end is good: higher is taken as better, and the text says so.
        const sorted = [...scale].sort((a, b) => (leadingNumber(a.label) as number) - (leadingNumber(b.label) as number));
        topTwo = sorted.slice(-2);
        bottomTwo = sorted.slice(0, 2);
        assumption = ` (taking the two highest codes, ${topTwo.map((r) => r.label).join(" and ")}, as the top two)`;
      }
      if (topTwo && bottomTwo) {
        const sum = (rs: CrosstabRow[]) => rs.reduce((a, r) => a + (r.total.pct ?? 0), 0);
        const t = round1(sum(topTwo));
        const b = round1(sum(bottomTwo));
        const ct = interval(t, n0);
        const cb = interval(b, n0);
        out.push({
          text: `Top two box on ${q.label}${assumption}: ${t}% (95% interval ${ct.lo} to ${ct.hi}); bottom two box: ${b}% (95% interval ${cb.lo} to ${cb.hi}) (${w}, base ${Math.round(n0)}${filterText}).`,
          theme: q.label,
          patternType: "level",
          stats: {
            ...common(result, q.label, n0),
            testType: "top_two_box",
            value: t,
            lo: ct.lo,
            hi: ct.hi,
            bottomTwo: b,
            bottomLo: cb.lo,
            bottomHi: cb.hi,
            topAnswers: topTwo.map((r) => r.label),
            bottomAnswers: bottomTwo.map((r) => r.label),
            directionAssumed: assumption !== "",
          },
        });
        continue;
      }
    }

    // Anything else: the leading answers.
    const ranked = [...answers].filter((r) => !DK.test(r.label)).sort((a, b) => (b.total.pct ?? 0) - (a.total.pct ?? 0));
    if (ranked.length === 0) continue;
    const top = ranked[0];
    const v = round1(top.total.pct as number);
    const ci = interval(v, n0, singleCol ? top.se?.[0] : null);
    const second = ranked[1];
    out.push({
      text: `On ${q.label}, the most common answer is "${top.label}" at ${v}% (95% interval ${ci.lo} to ${ci.hi})${second ? `, then "${second.label}" at ${round1(second.total.pct as number)}%` : ""} (${w}, base ${Math.round(n0)}${filterText}).`,
      theme: q.label,
      patternType: "level",
      stats: { ...common(result, q.label, n0), testType: "share", answer: top.label, value: v, lo: ci.lo, hi: ci.hi },
    });
  }
  return out.slice(0, MAX_PER_TABLE);
}

/**
 * A question compared across a banner variable where nothing reached significance. One finding per
 * question and banner variable, so a clean "no difference" is kept as a result and not lost.
 */
export function noDifferenceFindings(result: CrosstabResult): WideFinding[] {
  if (result.overall) return [];
  const out: WideFinding[] = [];
  const w = weightedNote(result);
  for (const q of result.questions) {
    result.blocks.forEach((block, bi) => {
      const cols = result.columns.map((c, k) => ({ c, k })).filter((x) => x.c.block === bi);
      if (cols.length < 2) return;
      let tested = 0;
      let flagged = 0;
      let smallest = 1;
      for (const r of q.rows) {
        if (r.isBase || r.isEffBase || r.isNet || r.isScore) continue;
        for (const { k } of cols) {
          const p = r.p?.[k];
          if (p === null || p === undefined) continue;
          tested++;
          smallest = Math.min(smallest, (r.pAdj?.[k] ?? p) as number);
          if (r.sig?.[k]) flagged++;
        }
      }
      if (tested < 3 || flagged > 0) return;
      const minBase = Math.min(...cols.map((x) => x.c.nEff || x.c.n));
      out.push({
        text: `No group differences on ${q.label} by ${block.label}: none of ${tested} comparisons reached significance (${w}, smallest group base ${Math.round(minBase)}). Not finding a difference is not proof the groups are alike.`,
        theme: `${q.label} by ${block.label}`,
        patternType: "no_difference",
        stats: {
          testType: "no_group_difference",
          question: q.label,
          bannerVariable: block.label,
          comparisonsTested: tested,
          smallestAdjustedP: Math.round(smallest * 10000) / 10000,
          minGroupBase: Math.round(minBase),
          weightVar: result.weightVar,
          correction: result.notes?.correction ?? "none",
          engineVersion: result.engine ?? null,
          caveats: ["not_significant", result.notes?.correction && result.notes.correction !== "none" ? `${result.notes.correction}_controlled_within_row` : "uncorrected_multiple_comparisons"],
        },
      });
    });
  }
  return out.slice(0, MAX_PER_TABLE);
}
