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
//     counts as stating the effect only when a sentence names the answer and each target group is
//     named as a whole word with a percentage in its own clause, at the right value, with the
//     right group higher. Anything less is reported as related or wrong, never as found;
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
const CLAUSE_BREAK = /,|;|:|\b(?:and|than|vs\.?|versus|against|while|whereas|but|compared (?:with|to))\b/i;

/**
 * The percentages an insight's text attaches to each target group. Only sentences that name the
 * answer count. Each sentence is cut into clauses where prose moves from one group's figure to the
 * next, and a group mention takes a percentage only from its own clause (the nearest one, if the
 * clause has several). A mention without a figure in its clause gets none: an unpaired figure is
 * never borrowed from a neighbouring clause, because that is exactly how one group's value gets
 * attributed to the other.
 */
export function groupValuesInText(text, target) {
  /** @type {Record<string, number[]>} */
  const byGroup = Object.fromEntries(target.groups.map((g) => [g.column, []]));
  const answer = new RegExp(`\\b${escape(target.answer)}`, "i");
  for (const sentence of String(text ?? "").split(/(?<=[.!?;])\s+/)) {
    if (!answer.test(sentence)) continue;
    for (const clause of sentence.split(new RegExp(CLAUSE_BREAK.source, "gi"))) {
      const percents = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b)/gi)].map((m) => ({ value: Number(m[1]), start: m.index, end: m.index + m[0].length }));
      if (!percents.length) continue;
      for (const g of target.groups) {
        const word = new RegExp(`\\b(?:${g.words.map(escape).join("|")})\\b`, "gi");
        for (const m of clause.matchAll(word)) {
          const start = m.index;
          const end = m.index + m[0].length;
          const distance = (p) => (p.end <= start ? start - p.end : p.start >= end ? p.start - end : 0);
          byGroup[g.column].push(percents.reduce((best, p) => (distance(p) < distance(best) ? p : best)).value);
        }
      }
    }
  }
  return byGroup;
}

const INSIGHT_LABEL = {
  matches: "states the effect",
  "wrong values": "names the groups with other values",
  "wrong direction": "names the groups in the wrong direction",
  "one group only": "mentions one group only (not the comparison)",
  absent: "does not state it",
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
    const values = groupValuesInText(i.text, target);
    const state = judgeValues(values, target);
    return { kind: i.kind, id: i.id, text: String(i.text).slice(0, 240), values, classification: INSIGHT_LABEL[state], states: state === "matches", anchoredOnTargetFinding: i.findingIds.some((id) => targetFindingIds.has(id)) };
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
