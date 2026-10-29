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
      /** OBJ-REV-005: what the threshold is in, declared before the table is read. When set and
       * the row found is the other kind (a mean where a share was meant, or the reverse), the
       * reading is unresolved instead of comparing numbers in different units. Absent on
       * expectations written before this existed: no check (unchanged behaviour). */
      measure?: "percent" | "mean" | null;
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
      /** OBJ-REV-005: as for a level. */
      measure?: "percent" | "mean" | null;
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
  /**
   * OBJ-REV-006: the stable identity of what was read, kept beside the display labels above.
   * `label`, `groupA` and `groupB` are wording and can change (a value-label edit, a re-read);
   * these record the table question's key, the row's raw answer code and each banner column's
   * variable and raw code, as the engine reported them, so a saved reading can be traced to the exact
   * category later. Absent when the table did not carry them (a net, mean or score row, or an
   * older saved result); never guessed from a label.
   */
  answerIdentity?: CategoryIdentity;
  groupAIdentity?: CategoryIdentity;
  groupBIdentity?: CategoryIdentity;
};

export type CategoryIdentity = { question?: string; variable?: string; rawCode?: string; rawCodes?: string[] };

/** The answer row's identity: its table question's key plus whatever the engine attached to the row. */
function rowIdentity(result: CrosstabResult, row: CrosstabRow): CategoryIdentity | undefined {
  const question = result.questions.find((q) => q.rows.includes(row))?.key;
  const own = identityOf(row);
  if (!question) return own;
  return { question, ...own };
}

/** The identity fields the engine attached to a row or column, or undefined when it attached none. */
function identityOf(source: { variable?: string; var?: string; rawCode?: string; rawCodes?: string[] } | undefined): CategoryIdentity | undefined {
  if (!source) return undefined;
  const id: CategoryIdentity = {};
  const variable = source.variable ?? source.var;
  if (variable) id.variable = variable;
  if (source.rawCode !== undefined && source.rawCode !== null) id.rawCode = String(source.rawCode);
  if (source.rawCodes && source.rawCodes.length > 0) id.rawCodes = source.rawCodes.map(String);
  return Object.keys(id).length > 0 ? id : undefined;
}

export type Reading = { stance: Stance; estimate: EvidenceEstimate; summary: string };

/**
 * Below this effective base an estimate is too thin to count either way
 * (OBJ-REV-M03). A conventional round-number survey-research threshold, not
 * derived from a formal power calculation or a specific confidence target
 * for this data: 30 is the usual rule-of-thumb floor below which a normal
 * approximation for a proportion or mean starts to misbehave. A base just
 * over this line is still thin; treat a stance near the boundary with the
 * same caution as one with a wide interval, not as settled.
 */
export const MIN_BASE = 30;
const Z = 1.96;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Every word of one is a whole word of the other ("very satisfied" within "very satisfied overall"). Containment by
 * characters matched "55" with "5" and "18 34" with "8" (batch 57, conformance AGG-06/16: the claim's 55+ resolved to
 * the 18-34 column), so words, and numbers, are compared whole. */
function wordsWithin(shorter: string, longer: string): boolean {
  const have = new Set(longer.split(" "));
  return shorter.split(" ").every((w) => have.has(w));
}

/** Exact match first, then one label whose words contain the other's. Null when nothing fits or two fit equally. */
export function matchLabel(labels: string[], wanted: string): string | null {
  const w = norm(wanted);
  if (!w) return null;
  const exact = labels.filter((l) => norm(l) === w);
  if (exact.length === 1) return exact[0];
  const loose = labels.filter((l) => {
    const n = norm(l);
    return n.length > 0 && (wordsWithin(w, n) || wordsWithin(n, w));
  });
  return loose.length === 1 ? loose[0] : null;
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

type Cell = { value: number; se: number | null; n: number | null; measure: "percent" | "mean" };

/**
 * One cell of a row as an estimate. col = -1 reads the total column. When the table has no
 * real banner/group variable, `columns` holds only the synthetic "All respondents" column,
 * so that column's own se[0] (design based when a sampling design was supplied) is the exact
 * standard error of the Total column's percentage too, and `singleCol` says so can be used;
 * with a real banner variable the Total mixes across groups and the engine never computed a
 * standard error for that mixture, so this still falls back to the naive SRS estimate below.
 */
function cell(row: CrosstabRow, col: number, singleCol: boolean): Cell | null {
  const measure: "percent" | "mean" = row.isMean || row.isScore ? "mean" : "percent";
  const value = col < 0 ? row.total.pct : row.pct[col];
  if (value === null || value === undefined) return null;
  const base = col < 0 ? row.total.base : row.base[col];
  const n = base ? base.nEff || base.n : null;
  let se: number | null = col < 0 ? (singleCol ? (row.se?.[0] ?? null) : null) : (row.se?.[col] ?? null);
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
  // Deliberately NOT rounded here (OBJ-REV-005): every caller classifies against these
  // exact bounds before it ever rounds anything for display. Round at the point of display
  // or storage, never before a comparison.
  return { lo, hi };
}

/**
 * The row an expectation points at, or null when the table has no such row - or when more
 * than one row across the candidate questions matches, and which one was actually meant is
 * genuinely ambiguous (OBJ-REV-006: "two questions sharing 'Yes', without a question
 * binding, still select the first matching question"). Without an explicit question
 * identity, more than one question in a table can have a row with the same answer label -
 * two separate "Yes/No" items, say, at very different percentages - and returning
 * whichever one happened to come first let the table's own row order silently decide the
 * research answer instead of the request actually naming which question it meant. Every
 * candidate question's matching row is collected first; a row is returned only when
 * exactly one match exists across all of them, and two or more is treated the same as zero
 * - unresolved, not a guess.
 */
export function locateRow(result: CrosstabResult, answer: string | null, question?: string | null): CrosstabRow | null {
  let qs = result.questions;
  if (question) {
    const qLabel = matchLabel(qs.map((q) => q.label), question);
    // A specific question was asked for but none matched: stop here rather
    // than falling through to search every other question in the table,
    // which can return an unrelated row under the right answer label.
    if (!qLabel) return null;
    qs = qs.filter((q) => q.label === qLabel);
  }
  const matches: CrosstabRow[] = [];
  for (const q of qs) {
    const rows = q.rows.filter((r) => !r.isBase && !r.isEffBase);
    if (answer === null) {
      const scored = rows.find((r) => r.isMean || r.isScore);
      if (scored) matches.push(scored);
      continue;
    }
    const label = matchLabel(rows.map((r) => r.label), answer);
    const row = label ? rows.find((r) => r.label === label) : undefined;
    if (row) matches.push(row);
  }
  return matches.length === 1 ? matches[0] : null;
}

const units = (c: Cell) => (c.measure === "percent" ? "%" : "");
const f = (x: number | null) => (x === null ? "n/a" : String(round(x)));

/**
 * A structured (numeric) expectation that names a specific question, answer, or group
 * that this table does not have is a binding failure, not an absence of evidence to hand
 * to the model instead (OBJ-REV-006: "missing explicit question falls back to model
 * judgment and stores supports"). readLevel/readComparison return this sentinel - an
 * explicit, already-"computed" Reading - rather than null whenever that happens, so
 * evaluateEvidenceQuestion's `if (computed) ... else judge(...)` branch takes the computed
 * path and records "could not locate what was asked for" instead of asking the model to
 * read the table fresh with no constraint tying it back to the specific request.
 */
/** OBJ-REV-005: a declared measure that differs from the row read is a binding failure, not a reading. */
function measureMismatch(declared: "percent" | "mean" | null | undefined, actual: "percent" | "mean", label: string): Reading | null {
  if (!declared || declared === actual) return null;
  const word = (m: "percent" | "mean") => (m === "percent" ? "a share (percent)" : "an average or score");
  return unresolved(
    `${label}: the expectation is ${word(declared)} but this row is ${word(actual)}, so the two cannot be compared and the expectation was not checked.`,
  );
}

function unresolved(reason: string): Reading {
  return {
    stance: "inconclusive",
    estimate: { measure: "percent", label: "", value: null, lo: null, hi: null, n: null },
    summary: reason,
  };
}

export function readLevel(result: CrosstabResult, exp: Extract<Expectation, { kind: "level" }>): Reading | null {
  const row = locateRow(result, exp.answer, exp.question);
  if (!row) {
    return unresolved(
      `Could not find ${exp.question ? `the question "${exp.question}"` : "a matching row"}${
        exp.answer ? ` with answer "${exp.answer}"` : ""
      } in this table, so the stated expectation could not be checked here.`,
    );
  }
  // result.overall is the table's own authoritative "no banner variable was
  // chosen" signal (OBJ-REV-M03): columns.length === 1 is also true for a
  // REAL banner variable that just happens to have only one category
  // present in this data, where reusing the Total's own se[0] would wrongly
  // treat that one sub-group's standard error as the question's synthetic
  // Total. OBJ-REV-M03: this comment used to go on to say a table saved
  // before `overall` existed falls back to a column-count heuristic instead
  // - that fallback is exactly what the OBJ-REV-005 fix immediately below
  // removed (an undefined `overall` is now always treated as false, never
  // inferred from column count), so the next paragraph is the current,
  // accurate description of what a pre-`overall` table actually gets.
  // Trust row.se[0] as the Total's own SE only when the table itself says so (OBJ-REV-005:
  // "legacy tables still use the unsafe column-count fallback"). A table saved before
  // `overall` existed has no way to tell "no banner variable" apart from "a real banner
  // with only one category present in this data" by column count alone, and guessing wrong
  // silently borrows a subgroup's SE as if it were the Total's - confidently computing a
  // verdict from the wrong uncertainty rather than admitting the uncertainty is unknown.
  // Treating an undefined `overall` as false (never guessing true from count) means that
  // ambiguity now safely falls through to cell()'s col<0-with-singleCol-false path, which
  // leaves se null and the reading comes back inconclusive instead of confidently wrong.
  const c = cell(row, -1, result.overall === true);
  if (!c) return unresolved(`${row.label}: this table has no readable value for the requested row, so the stated expectation could not be checked here.`);
  const mismatch = measureMismatch(exp.measure, c.measure, row.label);
  if (mismatch) return mismatch;
  const { lo, hi } = interval(c); // raw, unrounded: classified against these exact bounds below
  const estimate: EvidenceEstimate = {
    measure: c.measure,
    label: row.label,
    value: round(c.value),
    lo: lo === null ? null : round(lo),
    hi: hi === null ? null : round(hi),
    n: c.n,
    ...(rowIdentity(result, row) ? { answerIdentity: rowIdentity(result, row) } : {}),
  };
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
  if (!row) {
    return unresolved(
      `Could not find ${exp.question ? `the question "${exp.question}"` : "a matching row"}${
        exp.answer ? ` with answer "${exp.answer}"` : ""
      } in this table, so the stated comparison could not be checked here.`,
    );
  }
  const names = result.columns.map((c) => c.name);
  const a = matchLabel(names, exp.groupA);
  const b = matchLabel(names, exp.groupB);
  if (!a || !b || a === b) {
    return unresolved(
      `Could not find both groups ("${exp.groupA}" and "${exp.groupB}") as distinct columns in this table, so the stated comparison could not be checked here.`,
    );
  }
  // See readLevel's comment: overall is the direct signal for "this is the
  // synthetic All-respondents column", not just "there happens to be one
  // column".
  // Same reasoning as readLevel above: only an explicit `overall === true` is trusted.
  const singleCol = result.overall === true;
  const ca = cell(row, names.indexOf(a), singleCol);
  const cb = cell(row, names.indexOf(b), singleCol);
  if (!ca || !cb) {
    return unresolved(`${row.label}: this table has no readable value for one or both of "${a}"/"${b}", so the stated comparison could not be checked here.`);
  }
  const mismatch = measureMismatch(exp.measure, ca.measure, row.label);
  if (mismatch) return mismatch;

  // seA and seB are combined below as sqrt(seA^2 + seB^2), the variance of
  // a difference between two INDEPENDENT estimates. That holds for groupA
  // and groupB as two categories of the same banner variable (Male vs
  // Female, say): a respondent falls into at most one, so the two counts
  // never share anyone and the estimates are independent under the usual
  // survey design. It does not hold, and the comparison below should not
  // be trusted, when one group is actually an aggregate containing the
  // other (a Net/"isGroup" column compared against one of its own
  // constituent categories - they necessarily overlap and are therefore
  // strongly correlated, not independent) - guarded here, since both
  // belonging to the same banner block and one being a Net is cheaply
  // detectable. More generally, if groupA and groupB could share any
  // respondents at all (overlapping segments, or the same group read at
  // two waves with panel overlap), independence fails too, but that is not
  // something this function can detect from a single table; a reading
  // built that way should not be trusted without checking that assumption
  // by hand.
  const colA = result.columns[names.indexOf(a)];
  const colB = result.columns[names.indexOf(b)];
  const answerId = rowIdentity(result, row);
  const aId = identityOf(colA);
  const bId = identityOf(colB);
  const identities: Pick<EvidenceEstimate, "answerIdentity" | "groupAIdentity" | "groupBIdentity"> = {
    ...(answerId ? { answerIdentity: answerId } : {}),
    ...(aId ? { groupAIdentity: aId } : {}),
    ...(bId ? { groupBIdentity: bId } : {}),
  };
  if (colA && colB && colA.block === colB.block && (colA.isGroup || colB.isGroup)) {
    return {
      stance: "inconclusive",
      estimate: {
        measure: ca.measure,
        label: row.label,
        value: round(ca.value),
        lo: interval(ca).lo === null ? null : round(interval(ca).lo as number),
        hi: interval(ca).hi === null ? null : round(interval(ca).hi as number),
        n: ca.n,
        groupA: a,
        groupB: b,
        ...identities,
      },
      summary: `${row.label}: ${a} and ${b} are not independent (one is a combined group containing the other), so the gap between them can't be read as a clean comparison.`,
    };
  }
  const caInterval = interval(ca);
  const base: EvidenceEstimate = {
    measure: ca.measure,
    label: row.label,
    value: round(ca.value),
    lo: caInterval.lo === null ? null : round(caInterval.lo),
    hi: caInterval.hi === null ? null : round(caInterval.hi),
    n: ca.n,
    groupA: a,
    groupB: b,
    ...identities,
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
  // A declared margin takes precedence over raw statistical significance (OBJ-REV-005):
  // this used to only be checked in the "not clearly significant" fallback branch, so a
  // gap whose interval excluded zero (sLo > 0) was called "supports" even when the whole
  // gap sat inside the researcher's own declared no-meaningful-difference band - a real,
  // detectable difference that the researcher had already said was too small to matter.
  // Checking containment within the margin first, before the significance check, is what
  // actually gives the margin its stated precedence over a merely-significant gap.
  const withinMargin = margin !== null && lo > -margin && hi < margin;
  let stance: Stance;
  if (withinMargin) stance = "against";
  else if (sLo > 0) stance = "supports";
  else if (sHi < 0) stance = "against";
  else stance = "inconclusive";
  const note =
    stance === "inconclusive"
      ? "The interval for the gap includes zero, so this does not settle it either way."
      : withinMargin
        ? `The gap is within the ${margin}-point margin set for no meaningful difference.`
        : "";
  return {
    stance,
    estimate: base,
    summary: `${row.label}: ${a} ${f(ca.value)}${u} vs ${b} ${f(cb.value)}${u}, gap ${f(diff)} (95% interval ${f(lo)} to ${f(hi)}), expected ${exp.direction}. ${note}`.trim(),
  };
}

/**
 * OBJ-REV-006 / OBJ-REV-005: a share expectation must say WHICH answer's share it is about before
 * the table is read. "Does purchase differ between men and women?" compares the share answering
 * one particular answer of the Purchase question; with no answer named, there is no row to read
 * (a categorical question has no average row), and the old result was a bare "could not find a
 * matching row".
 *
 * Returns null when no selector is needed: an answer is named, the expectation is declared as an
 * average or score, or the table has exactly one average/score row the expectation can read.
 * Otherwise returns every (question, answer) pair in the candidate questions (the named question
 * only, when one is named), so the caller can resolve the selector explicitly or report that it
 * could not. This function never picks one: choosing "the first" or "the largest" answer would
 * let row order or the data decide what was asked.
 */
export function responseSelectorCandidates(
  result: CrosstabResult,
  exp: Expectation,
): { question: string; answer: string }[] | null {
  if (exp.answer !== null) return null;
  if (exp.measure === "mean") return null;
  if (locateRow(result, null, exp.question) !== null) return null;
  let qs = result.questions;
  if (exp.question) {
    const qLabel = matchLabel(qs.map((q) => q.label), exp.question);
    qs = qLabel ? qs.filter((q) => q.label === qLabel) : [];
  }
  return qs.flatMap((q) =>
    q.rows.filter((r) => !r.isBase && !r.isEffBase && !r.isMean && !r.isScore).map((r) => ({ question: q.label, answer: r.label })),
  );
}

const NON_SUBSTANTIVE = /\b(don'?t know|do not know|not sure|unsure|prefer not|refused|no answer|not applicable|n\/a|none of (these|the above)|other)\b/i;
const NEGATIVE = /(^|\s)(no|not|never|none|did not|didn'?t|does not|doesn'?t|do not|don'?t|non[- ]?\w*|neither)(\s|$)/i;
const LABEL_STOP = new Set(["the", "a", "an", "of", "in", "at", "on", "to", "and", "or", "for", "with", "by", "is", "are", "was", "were", "did", "do", "does"]);
const labelWords = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !LABEL_STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );

/**
 * OBJ-REV-006 / 005: whether a response chosen for an unnamed share expectation may become a
 * COMPUTED answer. A choice that merely exists in the table is not enough: "Do men purchase more
 * often than women?" over Bought online / Bought in store / Did not buy has no single answer that
 * means "purchase" (online alone changes the question; buying at all is a combination). Accepted
 * only when the meaning is structurally unambiguous:
 *   - the question has an explicit Yes/No or True/False pair ("don't know"-type answers
 *     aside), and the choice is not the negative one unless the evidence question itself is
 *     negative; or
 *   - the evidence question's own wording names the chosen answer (its distinctive words), and
 *     names no other answer.
 * Otherwise the reading must ask the researcher to name the answer(s); nothing is assumed.
 */
export function selectorAcceptance(
  candidates: { question: string; answer: string }[],
  chosen: { question: string; answer: string },
  evidence: { question: string; supportsIf?: string | null },
): { ok: true } | { ok: false; reason: string } {
  const answers = candidates.filter((c) => c.question === chosen.question).map((c) => c.answer);
  const substantive = answers.filter((a) => !NON_SUBSTANTIVE.test(a));
  const list = answers.map((a) => `"${a}"`).join(", ");
  // The answer may be named by the question or by what was written down as supporting it; whether
  // the question is itself about the negative answer is judged on the question alone (the
  // "undermines if" wording is usually negative and says nothing about which answer is meant).
  const asked = labelWords(`${evidence.question} ${evidence.supportsIf ?? ""}`);
  const questionNegative = NEGATIVE.test(` ${evidence.question.toLowerCase()} `);
  // Two channels can be exhaustive without either channel meaning the event being asked about.
  // Only explicit boolean answers permit an unnamed response; other pairs need a named answer.
  const booleanPair = substantive.length === 2 && (
    substantive.some((a) => /^yes$/i.test(a.trim())) && substantive.some((a) => /^no$/i.test(a.trim())) ||
    substantive.some((a) => /^true$/i.test(a.trim())) && substantive.some((a) => /^false$/i.test(a.trim()))
  );
  if (booleanPair && substantive.includes(chosen.answer)) {
    if (NEGATIVE.test(` ${chosen.answer.toLowerCase()} `) && !questionNegative) {
      return { ok: false, reason: `the matched answer "${chosen.answer}" is the negative one, which the question does not ask about (answers: ${list})` };
    }
    return { ok: true };
  }
  // Non-boolean answers: only a choice the question's own words name, uniquely.
  const shared = substantive.length > 1 ? [...labelWords(substantive[0])].filter((w) => substantive.every((a) => labelWords(a).has(w))) : [];
  const distinctive = (a: string) => [...labelWords(a)].filter((w) => !shared.includes(w));
  // A negative answer ("Did not buy") is named only by a question that is itself negative.
  const named = substantive.filter(
    (a) => distinctive(a).some((w) => asked.has(w)) && (questionNegative || !NEGATIVE.test(` ${a.toLowerCase()} `)),
  );
  if (named.length === 1 && named[0] === chosen.answer) return { ok: true };
  return {
    ok: false,
    reason:
      named.length > 1
        ? `the question's wording could mean more than one of this table's answers (${list})`
        : `the question does not say which of this table's answers (${list}) it compares, and choosing one, or a combination, would change the question`,
  };
}

/** The reading stored when a share expectation's answer could not be resolved: explicit, never a guess. */
export function responseSelectorUnresolved(reason: string): Reading {
  return unresolved(
    `Needs your resolution: the expectation compares a share but does not name which answer to compare, and ${reason}. ` +
      "Edit the question to name the answer or answers it means; nothing was assumed and no other reading was substituted.",
  );
}

export function readExpectation(result: CrosstabResult, exp: Expectation): Reading | null {
  return exp.kind === "level" ? readLevel(result, exp) : readComparison(result, exp);
}

/**
 * Several readings (or several questions under one objective) into one
 * stance. Aggregation policy, made explicit (OBJ-REV-M03): a genuine
 * conflict (both supports and against appear) is the only case flagged
 * mixed. Short of that, any supports present wins over inconclusive or
 * silent readings, and any against wins over inconclusive or silent in
 * turn - a result that actually speaks to the objective outweighs other
 * questions that turned up nothing either way, on the view that a silent
 * or inconclusive reading is an absence of evidence, not evidence of
 * absence. The trade-off this makes: if one sub-question out of several
 * supports the objective and the rest are silent or inconclusive, the
 * combined stance reads as a plain "supports" with no indication that most
 * of what was asked found nothing - read the underlying per-question
 * readings, not just this rollup, before treating "supports" here as
 * several questions agreeing rather than one question answering and the
 * others staying quiet.
 */
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
  const measure = r.measure === "percent" || r.measure === "mean" ? r.measure : null;
  if (r.kind === "level") {
    const threshold = num(r.threshold);
    if (threshold === null || (r.direction !== "above" && r.direction !== "below")) return null;
    return { kind: "level", answer, direction: r.direction, threshold, question, measure };
  }
  if (r.kind === "comparison") {
    const a = str(r.groupA);
    const b = str(r.groupB);
    if (!a || !b || (r.direction !== "higher" && r.direction !== "lower")) return null;
    return { kind: "comparison", answer, direction: r.direction, groupA: a, groupB: b, margin: num(r.margin), question, measure };
  }
  return null;
}
