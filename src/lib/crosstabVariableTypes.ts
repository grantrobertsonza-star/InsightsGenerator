import type { VariableInfo, VariableSet } from "./parseStatsFile";
import { isStringCategory } from "./variableKinds";

// The crosstab workspace's variable kinds: the type filter and the list it shows (Single choice,
// Rating scales, Text answers...). Moved out of CrosstabWorkspace.tsx so the rule lives in
// src/lib and has a test. Display grouping only: the engine decides how each variable is
// actually tabulated.
export type VarType = "single" | "multi" | "rating" | "numeric" | "grid" | "text" | "weight";

/** Best guess at the kind of a variable, from what the dictionary already holds. */
export function varTypeOf(v: VariableInfo, set?: VariableSet): VarType {
  if (v.weightLike) return "weight";
  if (set) return set.kind === "grid" || set.kind === "battery" ? "grid" : "multi";
  // A string column whose answers repeat within a small set (Gender; Purchase "Yes"/"No") is a
  // category the engine already tabulates as one. It used to be listed only under "Text answers",
  // hidden from "All types", so a researcher had to know to switch the filter to find it. Only
  // genuinely free text and identifiers stay text. Same shared rule as the objective lookups
  // (variableKinds.isStringCategory), so the two cannot disagree about what is a category.
  if (v.text) return isStringCategory(v) ? "single" : "text";
  if (v.numeric && !v.labelled) {
    return v.nDistinct > 10 ? "numeric" : v.nDistinct >= 3 ? "rating" : "single";
  }
  if (v.numeric && v.labelled && v.nDistinct >= 3 && v.nDistinct <= 10 &&
      /rat(e|ing)|satisf|agree|scale|likel|score|0 to 10|1 to 5/i.test(v.label)) return "rating";
  return "single";
}
