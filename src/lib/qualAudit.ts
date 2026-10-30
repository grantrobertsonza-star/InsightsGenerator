import type { AgreementCounts } from "./qualAnalysis";
import type { SegmentRole } from "./qualCoding";

// Pure helpers for two checks on AI coding: a random audit of a sample of
// turns (so the result says something about the whole transcript), and a
// stability check (apply the codebook again and see which turns come out
// differently). No model calls and no database, so all of it is testable.

// FNV-1a, so the same seed and ids always give the same order.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Audit sample --------------------------------------------------------

export const AUDIT_MIN = 30;
export const AUDIT_MAX = 120;
export const AUDIT_SHARE = 0.15;

/**
 * Suggested audit size: about 15% of the participant turns, never fewer than
 * 30 and never more than 120, and never more than there are turns. Sources on
 * double coding suggest checking roughly 10 to 25% of units, set in advance;
 * the floor keeps the interval from being uselessly wide on a short file.
 */
export function auditSampleSize(participantTurns: number): number {
  if (participantTurns <= 0) return 0;
  const raw = Math.round(participantTurns * AUDIT_SHARE);
  return Math.min(participantTurns, Math.max(AUDIT_MIN, Math.min(AUDIT_MAX, raw)));
}

export type AuditPick = { id: string; stratum: string; stratumSize: number };

export const NO_CODE_STRATUM = "none";

/**
 * Stratified random sample of participant turns. A turn's stratum is the
 * rarest code it carries (so small codes are not lost), or "none" when the
 * model gave it no code. Each stratum gets a share of the sample in proportion
 * to its size, with at least min(2, size) turns so every code can be looked
 * at. Within a stratum the choice is by seeded hash order: random in the
 * sense of not depending on content, and the same on a redraw.
 */
export function selectAuditSample(
  segments: { id: string; index: number; role: SegmentRole; codes: number[] }[],
  options: { size?: number; seed?: string } = {},
): AuditPick[] {
  const seed = options.seed ?? "audit";
  const pool = segments.filter((s) => s.role !== "moderator");
  const total = pool.length;
  const size = Math.min(options.size ?? auditSampleSize(total), total);
  if (size <= 0) return [];

  const freq = new Map<number, number>();
  for (const s of pool)
    for (const c of s.codes) freq.set(c, (freq.get(c) ?? 0) + 1);
  const strata = new Map<string, typeof pool>();
  for (const s of pool) {
    let key = NO_CODE_STRATUM;
    if (s.codes.length > 0) {
      const rarest = [...s.codes].sort(
        (a, b) => (freq.get(a) ?? 0) - (freq.get(b) ?? 0) || a - b,
      )[0];
      key = `code-${rarest}`;
    }
    strata.set(key, [...(strata.get(key) ?? []), s]);
  }

  const keys = [...strata.keys()].sort();
  const alloc = new Map<string, number>();
  for (const k of keys) {
    const n = strata.get(k)!.length;
    alloc.set(k, Math.min(n, Math.max(Math.min(2, n), Math.round((n / total) * size))));
  }
  // Trim or top up to hit the size exactly, adjusting the largest strata first.
  const bySize = [...keys].sort(
    (a, b) => strata.get(b)!.length - strata.get(a)!.length || a.localeCompare(b),
  );
  const sum = () => [...alloc.values()].reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum() > size && guard++ < 10000) {
    const k = bySize.find((x) => alloc.get(x)! > Math.min(2, strata.get(x)!.length));
    if (!k) break;
    alloc.set(k, alloc.get(k)! - 1);
  }
  guard = 0;
  while (sum() < size && guard++ < 10000) {
    const k = bySize.find((x) => alloc.get(x)! < strata.get(x)!.length);
    if (!k) break;
    alloc.set(k, alloc.get(k)! + 1);
  }

  const picks: AuditPick[] = [];
  for (const k of keys) {
    const members = strata
      .get(k)!
      .map((s) => ({ s, rank: hash(`${seed}:${s.id}`) }))
      .sort((a, b) => a.rank - b.rank || a.s.index - b.s.index)
      .slice(0, alloc.get(k)!);
    for (const m of members)
      picks.push({ id: m.s.id, stratum: k, stratumSize: strata.get(k)!.length });
  }
  return picks;
}

export type AuditRow = {
  stratum: string;
  stratumSize: number;
  // True when the model's set of codes for the turn is exactly the
  // researcher's set (no code missed, none added).
  match: boolean;
};

export type AuditEstimate = {
  reviewed: number;
  strata: number;
  // Estimated share of participant turns where the model's codes match yours
  // exactly, weighted by stratum size.
  accuracy: number;
  low: number;
  high: number;
  // Strata that were drawn but have no judged turn yet, left out of the weights.
  missingStrata: number;
  // Rough indication that the interval is too wide to say much.
  wide: boolean;
};

/**
 * Stratified estimate of turn-level exact agreement with a 95% normal
 * interval (stratum variances, finite population correction ignored, which is
 * slightly conservative). Strata with no judged turn are dropped and the
 * weights renormalised, and the count is reported so it can be shown.
 * Returns null when nothing has been judged.
 */
export function estimateAudit(
  rows: AuditRow[],
  drawnStrata: string[] = [],
): AuditEstimate | null {
  if (rows.length === 0) return null;
  const by = new Map<string, { size: number; n: number; hits: number }>();
  for (const r of rows) {
    const cur = by.get(r.stratum) ?? { size: r.stratumSize, n: 0, hits: 0 };
    cur.n += 1;
    if (r.match) cur.hits += 1;
    by.set(r.stratum, cur);
  }
  const totalSize = [...by.values()].reduce((a, s) => a + s.size, 0);
  let p = 0;
  let variance = 0;
  for (const s of by.values()) {
    const w = s.size / totalSize;
    const ph = s.hits / s.n;
    p += w * ph;
    // Add-half smoothing so a stratum that is 100% or 0% still contributes
    // some uncertainty instead of none.
    const q = (s.hits + 0.5) / (s.n + 1);
    variance += (w * w * q * (1 - q)) / s.n;
  }
  const se = Math.sqrt(variance);
  const low = Math.max(0, p - 1.96 * se);
  const high = Math.min(1, p + 1.96 * se);
  return {
    reviewed: rows.length,
    strata: by.size,
    accuracy: p,
    low,
    high,
    missingStrata: drawnStrata.filter((k) => !by.has(k)).length,
    wide: high - low > 0.25,
  };
}

// --- Fuller agreement figures for one code ----------------------------------

export type ExtendedAgreement = {
  // 2a / (2a + b + c): agreement on the turns that matter, ignoring the many
  // turns both sides left uncoded. Same as the F1 score.
  positiveAgreement: number | null;
  negativeAgreement: number | null;
  // Share of judged turns where either side applied the code.
  prevalence: number | null;
  // Raw agreement rescaled to -1..1 (PABAK), not pulled down by rare codes.
  pabak: number | null;
  // Model applies the code more (positive) or less (negative) often than you.
  bias: number | null;
  // True when the code is so rare or so common that kappa is hard to read.
  skewed: boolean;
};

export function extendedAgreement(c: AgreementCounts): ExtendedAgreement {
  if (c.n === 0)
    return {
      positiveAgreement: null,
      negativeAgreement: null,
      prevalence: null,
      pabak: null,
      bias: null,
      skewed: false,
    };
  const posDen = 2 * c.bothYes + c.modelOnly + c.researcherOnly;
  const negDen = 2 * c.bothNo + c.modelOnly + c.researcherOnly;
  const observed = (c.bothYes + c.bothNo) / c.n;
  const yesShare = (2 * c.bothYes + c.modelOnly + c.researcherOnly) / (2 * c.n);
  return {
    positiveAgreement: posDen === 0 ? null : (2 * c.bothYes) / posDen,
    negativeAgreement: negDen === 0 ? null : (2 * c.bothNo) / negDen,
    prevalence: (c.bothYes + c.modelOnly + c.researcherOnly) / c.n,
    pabak: 2 * observed - 1,
    bias: (c.modelOnly - c.researcherOnly) / c.n,
    skewed: yesShare < 0.15 || yesShare > 0.85,
  };
}

// --- Stability across repeated applications ------------------------------------

export type Assignments = Map<number, number[]>;

export type TurnStability = {
  index: number;
  runs: number;
  // Runs (the original included) that gave the same set of codes as the original.
  agree: number;
  // Codes given by some other run but not by the original, 1-based numbers.
  altCodes: number[];
  // Codes the original gave that some other run left out.
  droppedCodes: number[];
  confidence: "high" | "medium" | "low";
};

export function confidenceOf(agree: number, runs: number): "high" | "medium" | "low" {
  if (runs <= 1) return "high";
  if (agree >= runs) return "high";
  if (agree * 2 > runs) return "medium";
  return "low";
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Compares the original application with later ones turn by turn. A turn
 * that every run coded the same way is stable. Run to run consistency is the
 * signal used here because the model's own stated confidence is poorly
 * calibrated, whereas disagreement between repeated runs has been found to
 * track the labels that turn out wrong. It is a flag for a person to look
 * at: a stable turn can still be wrong, since repeated runs share the same
 * blind spots.
 */
export function compareRuns(
  original: Assignments,
  reruns: Assignments[],
  turnIndexes: number[],
): TurnStability[] {
  const runs = reruns.length + 1;
  return turnIndexes.map((index) => {
    const base = original.get(index) ?? [];
    let agree = 1;
    const alt = new Set<number>();
    const dropped = new Set<number>();
    for (const r of reruns) {
      const other = r.get(index) ?? [];
      if (sameSet(base, other)) agree += 1;
      for (const c of other) if (!base.includes(c)) alt.add(c);
      for (const c of base) if (!other.includes(c)) dropped.add(c);
    }
    return {
      index,
      runs,
      agree,
      altCodes: [...alt].sort((a, b) => a - b),
      droppedCodes: [...dropped].sort((a, b) => a - b),
      confidence: confidenceOf(agree, runs),
    };
  });
}

export type StabilitySummary = {
  turns: number;
  stable: number;
  share: number | null;
  low: number;
  medium: number;
};

export function summariseStability(
  rows: { agree: number; runs: number }[],
): StabilitySummary {
  let stable = 0;
  let low = 0;
  let medium = 0;
  for (const r of rows) {
    const c = confidenceOf(r.agree, r.runs);
    if (c === "high") stable += 1;
    else if (c === "medium") medium += 1;
    else low += 1;
  }
  return {
    turns: rows.length,
    stable,
    share: rows.length === 0 ? null : stable / rows.length,
    low,
    medium,
  };
}

/**
 * Per code: how often the codes agree across runs, as the share of turns
 * where the code was given by the original or any rerun that were given by
 * all of them. Low values mark a definition the model reads differently from
 * one run to the next.
 */
export function codeStability(
  original: Assignments,
  reruns: Assignments[],
  turnIndexes: number[],
  codeCount: number,
): { code: number; usedTurns: number; consistent: number }[] {
  const out: { code: number; usedTurns: number; consistent: number }[] = [];
  for (let code = 1; code <= codeCount; code++) {
    let used = 0;
    let consistent = 0;
    for (const index of turnIndexes) {
      const all = [original, ...reruns].map((r) =>
        (r.get(index) ?? []).includes(code),
      );
      if (!all.some(Boolean)) continue;
      used += 1;
      if (all.every(Boolean)) consistent += 1;
    }
    out.push({ code, usedTurns: used, consistent });
  }
  return out;
}

/**
 * Fewest turns a theme must come up in before its agreement figure is
 * treated as informative. Below this, one flipped turn moves the percentage
 * by ten points or more, so the figure is noise.
 */
export const MIN_TURNS_TO_JUDGE = 10;

export type HeadlineAgreement = {
  /** Equal-weight average over eligible themes of consistent / usedTurns; null when no theme is eligible. */
  value: number | null;
  /** Themes that came up in MIN_TURNS_TO_JUDGE turns or more: the headline's denominator. */
  eligible: number;
  /** Themes that came up at least once but in fewer turns, left out of the headline. */
  belowMinimum: number;
};

/**
 * The stability headline (Codex STAB-F04, batch 61). Per theme: of the turns where the original or any
 * other run gave the theme, the share where every run gave it; then the plain average over themes. It
 * counts consistent positive codings only, so it is stricter than pairwise agreement or kappa, which
 * also count turns every run left uncoded.
 *
 * Only themes with at least MIN_TURNS_TO_JUDGE turns count. When none has that many, there is no
 * headline (value null). The minimum is never relaxed: it used to fall back to every used theme, so a
 * theme seen in one turn could give a 100% headline while being marked too few to judge.
 */
export function headlineCodeAgreement(perCode: { used: number; consistent: number }[]): HeadlineAgreement {
  const used = perCode.filter((u) => u.used > 0);
  const eligible = used.filter((u) => u.used >= MIN_TURNS_TO_JUDGE);
  return {
    value: eligible.length === 0 ? null : eligible.reduce((a, u) => a + u.consistent / u.used, 0) / eligible.length,
    eligible: eligible.length,
    belowMinimum: used.length - eligible.length,
  };
}

/**
 * Cohen's kappa for two yes/no codings of the same turns: agreement beyond
 * what the two coders' own rates of saying yes would produce by chance.
 * null when chance agreement is already total (nobody ever varied), where
 * kappa is undefined.
 */
export function yesNoKappa(a: boolean[], b: boolean[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n === 0) return null;
  let both = 0;
  let neither = 0;
  let aYes = 0;
  let bYes = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) both += 1;
    if (!a[i] && !b[i]) neither += 1;
    if (a[i]) aYes += 1;
    if (b[i]) bYes += 1;
  }
  const po = (both + neither) / n;
  const pe = (aYes / n) * (bYes / n) + ((n - aYes) / n) * ((n - bYes) / n);
  if (pe >= 1) return null;
  return (po - pe) / (1 - pe);
}

/**
 * Per code: the average pairwise Cohen's kappa over every pair of runs
 * (original included), taken over all the turns, so turns where no run gave
 * the code count as agreement, as they should for a chance-corrected figure.
 * `runs` holds, per turn, the codes each run gave.
 */
export function codeKappas(
  turns: number[][][],
  codeCount: number,
): { code: number; kappa: number | null }[] {
  const out: { code: number; kappa: number | null }[] = [];
  const runCount = turns.reduce((m, t) => Math.max(m, t.length), 0);
  for (let code = 1; code <= codeCount; code++) {
    const series: boolean[][] = [];
    for (let r = 0; r < runCount; r++)
      series.push(turns.map((t) => (t[r] ?? []).includes(code)));
    const ks: number[] = [];
    for (let i = 0; i < series.length; i++)
      for (let j = i + 1; j < series.length; j++) {
        const k = yesNoKappa(series[i], series[j]);
        if (k !== null) ks.push(k);
      }
    out.push({
      code,
      kappa: ks.length === 0 ? null : ks.reduce((x, y) => x + y, 0) / ks.length,
    });
  }
  return out;
}

/**
 * Per code: pairwise agreement between runs (batch 61, Grant 28 October 2026). For every turn and every
 * pair of runs (the original included), whether the two runs made the same yes/no decision on the code;
 * the share of those comparisons that agree. Turns where neither run gave the code count as agreement,
 * as in codeKappas, so this is the uncorrected companion of the kappa: the within-model analogue of
 * intra-coder percentage agreement. `turns` holds, per turn, the codes each run gave, and must cover
 * only complete, comparable decisions (the stability check leaves out incomplete passes). `comparisons`
 * is the denominator: turns times run pairs.
 */
export function codePairwiseAgreement(
  turns: number[][][],
  codeCount: number,
): { code: number; agreement: number | null; comparisons: number }[] {
  const runCount = turns.reduce((m, t) => Math.max(m, t.length), 0);
  const out: { code: number; agreement: number | null; comparisons: number }[] = [];
  for (let code = 1; code <= codeCount; code++) {
    let same = 0;
    let comparisons = 0;
    for (const t of turns)
      for (let i = 0; i < runCount; i++)
        for (let j = i + 1; j < runCount; j++) {
          comparisons += 1;
          if ((t[i] ?? []).includes(code) === (t[j] ?? []).includes(code)) same += 1;
        }
    out.push({ code, agreement: comparisons === 0 ? null : same / comparisons, comparisons });
  }
  return out;
}

/**
 * A plain label for a run-to-run kappa, so a reader does not have to know the scale. The cut-offs are
 * the commonly used ones (0.80 and above strong, 0.60 to 0.79 moderate); they are a convention, not a law.
 */
export function kappaBand(kappa: number | null, tooFew: boolean): string {
  if (tooFew) return "Too few turns to judge";
  if (kappa === null) return "Not available";
  if (kappa >= 0.8) return "Strong";
  if (kappa >= 0.6) return "Moderate";
  return "Weak";
}

// --- Reviewer attention ---------------------------------------------------

export type AttentionEvent = { at: number; changed: boolean };

export type AttentionCheck = {
  decisions: number;
  changeRate: number;
  // Median seconds between consecutive decisions made in one sitting
  // (gaps over ten minutes are treated as breaks and ignored).
  medianSeconds: number | null;
  flagged: boolean;
  reasons: string[];
};

const SITTING_GAP_MS = 10 * 60 * 1000;

/**
 * A prompt, not a verdict: reviewers shown AI suggestions tend to accept
 * most of them, and a run of fast, unchanged decisions is the pattern that
 * rubber-stamping leaves. Needs at least 8 decisions to say anything.
 */
export function attentionCheck(events: AttentionEvent[]): AttentionCheck | null {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const decisions = sorted.length;
  const changeRate = sorted.filter((e) => e.changed).length / decisions;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].at - sorted[i - 1].at;
    if (g <= SITTING_GAP_MS) gaps.push(g / 1000);
  }
  gaps.sort((a, b) => a - b);
  const medianSeconds =
    gaps.length === 0
      ? null
      : gaps.length % 2
        ? gaps[(gaps.length - 1) / 2]
        : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  const reasons: string[] = [];
  if (decisions >= 8) {
    if (changeRate <= 0.05)
      reasons.push("almost every decision left the model's themes as they were");
    if (medianSeconds !== null && medianSeconds < 10)
      reasons.push("decisions are coming in under about 10 seconds each");
  }
  return {
    decisions,
    changeRate,
    medianSeconds,
    flagged: reasons.length === 2 || (decisions >= 15 && changeRate === 0),
    reasons,
  };
}


/**
 * Two looser readings of the same stability runs, shown beside the strict
 * whole-turn check. `perTurn` holds, for each turn, the code numbers each run
 * gave. `themeOf` maps a code number to the broader theme it sits under, or
 * null when it has none.
 *
 * - themeShare: the share of turns where every run gave the same set of
 *   broader themes (a code with no theme stands for itself). null when no code
 *   that appears has a theme, because then it would only repeat the strict figure.
 * - overlap: for each turn, the average overlap (shared codes over all codes
 *   given) between every pair of runs, then averaged over turns. Two runs that
 *   share three of four codes score 0.75 instead of counting as a miss.
 */
export function looserAgreement(
  perTurn: number[][][],
  themeOf: (code: number) => string | null,
): { themeShare: number | null; overlap: number | null; themed: boolean } {
  if (perTurn.length === 0) return { themeShare: null, overlap: null, themed: false };
  let themed = false;
  let themeSame = 0;
  let overlapSum = 0;
  for (const runs of perTurn) {
    const groupSets = runs.map((codes) => {
      const out = new Set<string>();
      for (const c of codes) {
        const t = themeOf(c);
        if (t) themed = true;
        out.add(t ? `t:${t}` : `c:${c}`);
      }
      return out;
    });
    if (groupSets.every((g) => g.size === groupSets[0].size && [...g].every((x) => groupSets[0].has(x)))) themeSame += 1;
    let pairs = 0;
    let sum = 0;
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = new Set(runs[i]);
        const b = new Set(runs[j]);
        const union = new Set([...a, ...b]).size;
        const inter = [...a].filter((x) => b.has(x)).length;
        sum += union === 0 ? 1 : inter / union;
        pairs += 1;
      }
    }
    overlapSum += pairs === 0 ? 1 : sum / pairs;
  }
  return {
    themeShare: themed ? themeSame / perTurn.length : null,
    overlap: overlapSum / perTurn.length,
    themed,
  };
}
