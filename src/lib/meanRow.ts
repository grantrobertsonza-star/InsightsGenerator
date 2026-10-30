import type { CrosstabGroup, VariableInfo } from "./parseStatsFile";

/**
 * The mean row the engine computes for a row (kind "mean": the weighted mean of the numeric answer
 * codes over the table's valid cases, leaving out declared missing values and don't know, refused
 * and not applicable answers). Placed above the answers, so the distribution stays below it.
 * qualifyCodes asks the engine to say so in the label when the codes may not be a scale; whether
 * they are is the engine's one ordered-scale rule (_is_ordered_scale), not decided here.
 * Kept apart from crosstabAsk.ts (which holds the model client) so client code can use it.
 */
export function meanGroupFor(label: string): CrosstabGroup {
  return { label, cats: [], kind: "mean", place: "above", qualifyCodes: true };
}

/**
 * Treated as a 10 or 11 point rating scale (1 to 10, 0 to 10): numeric answers with 10 or 11
 * distinct values. Such a row is read by its mean (Grant, 2026-10-22: StarterTabs gave only counts
 * for 0 to 10 scales), so the starter set adds a mean row above its answers.
 *
 * A broad heuristic: it looks at the count of distinct values only, not whether they run on
 * consecutively or the question is a rating. The engine does not catch the difference either:
 * for unlabelled whole-number codes its ordered-scale rule (_is_ordered_scale) accepts any 10 or
 * more distinct values, so a count variable with 10 distinct values gets an unqualified mean row
 * like a rating. The mean row's label is qualified only for codes the engine judges unordered:
 * a column the file declares nominal, labelled codes that are not a scale, or codes that are not
 * whole numbers. See claude/starter-tables.md.
 */
export function isTenPointScale(v: Pick<VariableInfo, "numeric" | "nDistinct">): boolean {
  return v.numeric && v.nDistinct >= 10 && v.nDistinct <= 11;
}
