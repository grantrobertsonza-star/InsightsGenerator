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
 * A 10 or 11 point rating scale (1 to 10, 0 to 10): numeric answers with 10 or 11 distinct values.
 * Such a row is read by its mean (Grant, 2026-10-22: StarterTabs gave only counts for 0 to 10
 * scales), so the starter set adds a mean row above its answers. The rule looks at the count of
 * values only; the engine still qualifies the mean's label when the codes are not an ordered scale,
 * so a count variable that happens to have 10 values is not presented as a score unqualified.
 */
export function isTenPointScale(v: Pick<VariableInfo, "numeric" | "nDistinct">): boolean {
  return v.numeric && v.nDistinct >= 10 && v.nDistinct <= 11;
}
