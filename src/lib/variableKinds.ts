import { MAX_CATEGORY_CARDINALITY } from "./bannerPlanComputation";
import type { VariableInfo } from "./parseStatsFile";

// OBJ-REV-006 (golden-thread repair): the engine flags any non-numeric column without value labels
// as `text` (free text). A string column whose answers repeat within a small set - "Male"/"Female",
// "Yes"/"No", region names - is a category, and the crosstab engine already calculates it as one;
// but every lookup that filtered `!v.text` hid it, so an objective about purchase by gender could
// not reach the Gender or Purchase variables at all. These helpers say when such a column is a
// category, using the app's existing category limit (MAX_CATEGORY_CARDINALITY) rather than a new
// threshold. The `text` flag itself is unchanged, because other consumers (brand-health and CSM
// metric mapping) expect numeric scales.

/** A string variable without value labels whose answers repeat within a small set. */
export function isStringCategory(v: Pick<VariableInfo, "numeric" | "labelled" | "nDistinct" | "nValid">): boolean {
  return (
    !v.numeric &&
    !v.labelled &&
    v.nDistinct >= 2 &&
    v.nDistinct <= MAX_CATEGORY_CARDINALITY &&
    // each answer given at least twice on average: a short list of repeated answers, not free text
    v.nValid >= 2 * v.nDistinct
  );
}

/** May a variable be offered to evidence lookup (question drafting and table planning)? */
export function isLookupEligible(v: VariableInfo): boolean {
  if (v.weightLike) return false;
  return !v.text || isStringCategory(v);
}
