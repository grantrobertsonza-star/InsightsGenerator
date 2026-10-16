// The crosstab workspace's variable list (crosstabVariableTypes.varTypeOf): a string column whose
// answers repeat within a small set - Gender, a "Yes"/"No" Purchase - is listed as a single-choice
// question under "All types". It used to be hidden under "Text answers" only, so a researcher had
// to know to switch the type filter to find it (found by the golden-thread browser smoke). Free
// text and identifiers stay under "Text answers". Same shared rule as the objective lookups
// (variableKinds.isStringCategory), so the two cannot disagree about what is a category.
import { describe, expect, it } from "vitest";
import type { VariableInfo } from "../parseStatsFile";


const base = { label: "", numeric: false, labelled: false, weightLike: false, isFlag: false, pctValid: 100, inSet: undefined } as unknown as VariableInfo;
const v = (over: Partial<VariableInfo>) => ({ ...base, ...over }) as VariableInfo;

describe("crosstab workspace variable types", () => {
  it("string categories are single choice; free text and identifiers stay text; numeric typing is unchanged", async () => {
    const { varTypeOf } = await import("../crosstabVariableTypes");
    expect(varTypeOf(v({ name: "Gender", text: true, nDistinct: 2, nValid: 200 }))).toBe("single");
    expect(varTypeOf(v({ name: "Purchase", text: true, nDistinct: 2, nValid: 200 }))).toBe("single");
    expect(varTypeOf(v({ name: "RespondentID", text: true, nDistinct: 200, nValid: 200 }))).toBe("text");
    expect(varTypeOf(v({ name: "Comment", text: true, nDistinct: 150, nValid: 200 }))).toBe("text");
    // boundary: answers given fewer than twice on average are free text, not a category
    expect(varTypeOf(v({ name: "Few", text: true, nDistinct: 3, nValid: 5 }))).toBe("text");
    expect(varTypeOf(v({ name: "Score", numeric: true, text: false, nDistinct: 5, nValid: 200 }))).toBe("rating");
    expect(varTypeOf(v({ name: "w", numeric: true, weightLike: true, nDistinct: 50, nValid: 200 }))).toBe("weight");
  });
});
