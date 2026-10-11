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

function baseOf(row: CrosstabRow): number | null {
  const b = row.total.base;
  return b ? b.nEff || b.n : null;
}

function leadingNumber(label: string): number | null {
  const m = label.trim().match(/^(-?\d+(?:\.\d+)?)\b/);
  return m ? Number(m[1]) : null;
}

function interval(pct: number, n: number): { lo: number; hi: number } {
  const p = Math.min(Math.max(pct / 100, 0), 1);
  const se = Math.sqrt((p * (1 - p)) / n) * 100;
  return { lo: round1(Math.max(0, pct - Z * se)), hi: round1(Math.min(100, pct + Z * se)) };
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
        const ci = interval(v, n);
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
    const n0 = baseOf(answers[0]);
    if (n0 === null || n0 < MIN_BASE) continue;

    if (q.kind === "multi") {
      for (const r of [...answers].sort((a, b) => (b.total.pct ?? 0) - (a.total.pct ?? 0)).slice(0, 3)) {
        const v = round1(r.total.pct as number);
        const ci = interval(v, n0);
        out.push({
          text: `${v}% of respondents chose "${r.label}" on ${q.label} (95% interval ${ci.lo} to ${ci.hi}; ${w}, base ${Math.round(n0)}${filterText}).`,
          theme: q.label,
          patternType: "level",
          stats: { ...common(result, q.label, n0), testType: "share", answer: r.label, value: v, lo: ci.lo, hi: ci.hi },
        });
      }
      continue;
    }

    // NPS: a 0 to 10 question.
    const numbered = answers.map((r) => ({ r, k: leadingNumber(r.label) }));
    const isNps = numbered.length >= 11 && numbered.every((x) => x.k !== null) && numbered.some((x) => x.k === 0) && numbered.some((x) => x.k === 10);
    if (isNps) {
      const pct = (lo: number, hi: number) => numbered.filter((x) => (x.k as number) >= lo && (x.k as number) <= hi).reduce((a, x) => a + (x.r.total.pct ?? 0), 0);
      const prom = pct(9, 10);
      const det = pct(0, 6);
      const passive = pct(7, 8);
      const nps = prom - det;
      const se = Math.sqrt(Math.max(0, (prom / 100 + det / 100 - ((prom - det) / 100) ** 2) / n0)) * 100;
      const lo = round1(nps - Z * se);
      const hi = round1(nps + Z * se);
      out.push({
        text: `Net Promoter Score on ${q.label} is ${round1(nps)} (promoters ${round1(prom)}%, passives ${round1(passive)}%, detractors ${round1(det)}%; 95% interval ${lo} to ${hi}; ${w}, base ${Math.round(n0)}${filterText}).`,
        theme: q.label,
        patternType: "level",
        stats: { ...common(result, q.label, n0), testType: "nps", value: round1(nps), lo, hi, promoters: round1(prom), passives: round1(passive), detractors: round1(det) },
      });
      continue;
    }

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
    const ci = interval(v, n0);
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
