// Benchmark measurement: did the pipeline find a group difference the report never mentions, and
// did an insight state it correctly? Used by real-model-quality.check.mjs; tested on its own by
// src/lib/__tests__/omittedEffectMeasure.test.ts.
//
// Codex 2026-10-18 (20977c8) showed the earlier text heuristics misclassified both ways: the two
// correctly grounded computed findings (one per group) were missed because the matcher wanted both
// figures in one sentence, and repeated "Female only" text counted as a male/female comparison
// because /male/ matches inside "Female". So:
//   - computed findings are matched on their SAVED STRUCTURED STATISTICS (stated_stats: question,
//     answer, banner variable, banner column and the column's value), never on their wording. The
//     effect is found only when every target group has a finding with the right value and the
//     expected group is the higher one;
//   - an insight is text written by the model, so it has no structured statistics of its own. It
//     counts as stating the effect only when its text affirmatively attributes each group's value
//     to the answer (readTextAttribution: no negation, condition, possibility or question in the
//     sentence, each group named
//     as a whole word with a percentage in its own clause, and that clause either naming the
//     answer or being a bare group figure anchored to it), at the right value, with the right
//     group higher. Co-occurring tokens are not enough (Codex 2026-10-18: "Convenience was not
//     measured, while 70% of men and 50% of women reported good service"). Where attribution or
//     polarity is uncertain the insight is reported as related or unestablished, never as found;
//   - a missing target table means the effect could not be measured, which is different from
//     "not found".
// The measurement is generic: the target (question, answer, banner, groups, values, which is
// higher) is passed in, not built into the matcher.

const norm = (v) => String(v ?? "").trim().toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const within = (a, b, tolerance) => typeof a === "number" && Math.abs(a - b) <= tolerance;

/**
 * @typedef {{ column: string, value: number, words: string[] }} TargetGroup
 * @typedef {{ question: string, answer: string, banner: string, groups: TargetGroup[], higher: string, tolerance: number }} TargetEffect
 */

/** Per target group, the computed findings (by structured statistics) that report that group's value for the answer. */
export function groupFindings(findings, target) {
  /** @type {Record<string, { findingId: string, value: number }[]>} */
  const byGroup = Object.fromEntries(target.groups.map((g) => [g.column, []]));
  for (const f of findings) {
    const s = f.stated_stats;
    if (f.origin !== "generated" || !s || typeof s !== "object") continue;
    if (norm(s.question) !== norm(target.question) || norm(s.answer) !== norm(target.answer) || norm(s.bannerVariable) !== norm(target.banner)) continue;
    if (typeof s.columnValue !== "number") continue;
    const group = target.groups.find((g) => norm(g.column) === norm(s.column));
    if (group) byGroup[group.column].push({ findingId: f.id, value: s.columnValue });
  }
  return byGroup;
}

/** Whether a set of group values is the target effect: every group at its value, the right one higher. */
function judgeValues(valuesByGroup, target) {
  const missing = target.groups.filter((g) => !valuesByGroup[g.column]?.length);
  if (missing.length === target.groups.length) return "absent";
  if (missing.length) return "one group only";
  const right = target.groups.every((g) => valuesByGroup[g.column].some((v) => within(v, g.value, target.tolerance)));
  if (!right) return "wrong values";
  const higher = target.groups.find((g) => g.column === target.higher);
  const others = target.groups.filter((g) => g.column !== target.higher);
  const top = Math.max(...valuesByGroup[higher.column].filter((v) => within(v, higher.value, target.tolerance)));
  return others.every((g) => valuesByGroup[g.column].some((v) => v < top)) ? "matches" : "wrong direction";
}

// Where one group's figure ends and the next begins in prose: "men (70%) than women (50%)",
// "70% of men and 50% of women", "men 70%, women 50%", "65% of men against 52% of women".
const CLAUSE_BREAK = /,|;|:|\b(?:and|or|than|vs\.?|versus|against|while|whereas|but|compared (?:with|to))\b/i;
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b|percent\b)/gi;
// A sentence that does not assert something observed is not read as stating the effect:
//   - negation: "Convenience was not measured, ...", "Convenience is not chosen by 70% of men ...";
//   - possibility, condition, prediction or supposition: "Convenience might be chosen by 70% of
//     men ...", "If Convenience were chosen by 70% of men ..., we would ...", "is likely to",
//     "expected", "assuming";
//   - a question.
// Deliberately broad (Codex 2026-10-18, twice): a correct statement caught by it is reported as
// unestablished, never as stating the effect.
const NOT_ASSERTED = new RegExp(
  [
    "\\b(?:not|no|never|none|neither|nor|without|cannot|unlike|excluding|except)\\b|n['\\u2019]t\\b",
    "\\b(?:might|may|could|would|should|can|if|whether|unless|suppose|supposing|assume|assuming|assumed|hypothetical(?:ly)?|possibl[ey]|perhaps|probabl[ey]|likely|unlikely|potential(?:ly)?|expect(?:s|ed)?|predict(?:s|ed)?|project(?:s|ed)?|forecast(?:s)?|hope(?:s|d)?|plan(?:s|ned)?|aim(?:s|ed)?|target(?:s|ed)?|imagine|scenario)\\b",
    "\\?\\s*$",
  ].join("|"),
  "i",
);

// Words that may sit next to a group's figure without changing what the figure is about. A clause
// with a group figure and anything else ("50% of women reported good service") is about something
// else, or at least not established to be about the answer.
const FILLER = new Set(
  "of among for to the a an at in by with from on respondents respondent people customers customer participants consumers users shoppers buyers are is was were do does did compared only just about around roughly nearly almost some more less higher lower fewer per cent percent chose choose chooses chosen selected select selects pick picks picked cited cite cites mentioned mention mentions said say says it this that so also likewise too as their them they".split(" "),
);

/**
 * How an insight's text attributes percentages to each target group for the target answer, read
 * conservatively. A figure counts for a group only when the text affirmatively attributes it:
 *   - sentences that do not name the answer are ignored, and a sentence that is not an assertion
 *     of something observed (negated, conditional, possible, predicted, supposed, or a question;
 *     see NOT_ASSERTED) is ignored as a whole and recorded as unestablished;
 *   - a sentence is cut into clauses where prose moves from one group's figure to the next; a
 *     group mention takes a percentage only from its own clause (the nearest, if several);
 *   - a clause that names the answer attributes its own group figures ("Convenience matters more
 *     to men (70%)");
 *   - a clause with only a group and a figure ("than to women (50%)", "50% of women chose") is
 *     attributed only when the same sentence anchors the answer: a clause that names the answer
 *     and itself carries a group figure, or a bare label ("Convenience:");
 *   - any other clause with a group figure ("50% of women reported good service") is not counted
 *     and is recorded as unestablished.
 * Returns the counted values per group and the reasons anything was not counted.
 */
export function readTextAttribution(text, target) {
  /** @type {Record<string, number[]>} */
  const values = Object.fromEntries(target.groups.map((g) => [g.column, []]));
  /** @type {string[]} */
  const unestablished = [];
  const answer = new RegExp(`\\b${escape(target.answer)}`, "i");
  const groupWord = (g) => new RegExp(`\\b(?:${g.words.map(escape).join("|")})\\b`, "gi");
  const anyGroupWord = new RegExp(`\\b(?:${target.groups.flatMap((g) => g.words).map(escape).join("|")})\\b`, "gi");
  const figuresIn = (clause) => {
    const percents = [...clause.matchAll(PERCENT)].map((m) => ({ value: Number(m[1]), start: m.index, end: m.index + m[0].length }));
    /** @type {[string, number][]} */
    const out = [];
    if (!percents.length) return out;
    for (const g of target.groups) {
      for (const m of clause.matchAll(groupWord(g))) {
        const distance = (p) => (p.end <= m.index ? m.index - p.end : p.start >= m.index + m[0].length ? p.start - (m.index + m[0].length) : 0);
        out.push([g.column, percents.reduce((best, p) => (distance(p) < distance(best) ? p : best)).value]);
      }
    }
    return out;
  };
  const leftover = (clause) =>
    clause
      .replace(PERCENT, " ")
      .replace(anyGroupWord, " ")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w && !FILLER.has(w));
  for (const sentence of String(text ?? "").split(/(?<=[.!?;])\s+/)) {
    if (!answer.test(sentence)) continue;
    if (NOT_ASSERTED.test(sentence)) {
      if (figuresIn(sentence).length) unestablished.push(`not asserted (negated, conditional, possible or a question): ${sentence.trim().slice(0, 120)}`);
      continue;
    }
    const clauses = sentence.split(new RegExp(CLAUSE_BREAK.source, "gi")).map((c) => {
      const figures = figuresIn(c);
      const namesAnswer = answer.test(c);
      const rest = leftover(c.replace(new RegExp(answer.source, "gi"), " "));
      return { text: c, figures, namesAnswer, label: namesAnswer && figures.length === 0 && rest.length === 0, bare: !namesAnswer && rest.length === 0 };
    });
    const anchored = clauses.some((c) => c.label || (c.namesAnswer && c.figures.length > 0));
    for (const c of clauses) {
      if (!c.figures.length) continue;
      if (c.namesAnswer || (c.bare && anchored)) for (const [group, value] of c.figures) values[group].push(value);
      else unestablished.push(`figure not attributed to ${target.answer}: ${c.text.trim().slice(0, 120)}`);
    }
  }
  return { values, unestablished };
}

/** The percentages an insight's text affirmatively attributes to each target group (see readTextAttribution). */
export function groupValuesInText(text, target) {
  return readTextAttribution(text, target).values;
}

const INSIGHT_LABEL = {
  matches: "states the effect",
  "wrong values": "names the groups with other values",
  "wrong direction": "names the groups in the wrong direction",
  "one group only": "mentions one group only (not the comparison)",
  absent: "does not state it",
  unestablished: "mentions the answer and group figures without establishing the effect (not counted)",
};

/**
 * @param {{ findings: { id: string, origin: string, stated_stats: any }[], insights: { kind: string, id: string, text: string, findingIds: string[] }[], computedTables: string[] }} evidence
 * @param {TargetEffect} target
 */
export function measureOmittedEffect(evidence, target) {
  const tablePresent = evidence.computedTables.some((t) => norm(t) === norm(target.question));
  const byGroup = groupFindings(evidence.findings, target);
  const findingState = judgeValues(Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, v.map((x) => x.value)])), target);
  const targetFindingIds = new Set(Object.values(byGroup).flat().map((x) => x.findingId));
  const insights = evidence.insights.map((i) => {
    const { values, unestablished } = readTextAttribution(i.text, target);
    const judged = judgeValues(values, target);
    // Figures the text could not be shown to attribute to the answer never make a positive, but
    // they are reported, so a reader sees the insight was related rather than silent.
    const state = judged === "absent" && unestablished.length ? "unestablished" : judged;
    return { kind: i.kind, id: i.id, text: String(i.text).slice(0, 240), values, unestablished, classification: INSIGHT_LABEL[state], states: state === "matches", anchoredOnTargetFinding: i.findingIds.some((id) => targetFindingIds.has(id)) };
  });
  const stated = insights.filter((i) => i.states);
  const related = insights.filter((i) => !i.states && i.classification !== INSIGHT_LABEL.absent);
  let outcome;
  if (!tablePresent) outcome = `could not be measured: the ${target.question} by ${target.banner} table was not committed`;
  else if (findingState !== "matches") outcome = findingState === "absent" ? "not found in the computed findings" : `computed findings disagree with the target (${findingState})`;
  else if (stated.length) outcome = "found in the computed findings and stated by an insight";
  else outcome = "found in the computed findings; no insight states it";
  return {
    target,
    tablePresent,
    computed: { classification: findingState, groups: byGroup },
    insightsStating: stated,
    insightsRelatedButNotStating: related,
    outcome,
  };
}
