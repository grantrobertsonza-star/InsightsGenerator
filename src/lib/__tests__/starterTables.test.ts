import { describe, expect, it } from "vitest";
import { planStarterTables } from "../starterTables";
import type { VariableDictionary, VariableInfo } from "../parseStatsFile";

function v(name: string, label: string, extra: Partial<VariableInfo> = {}): VariableInfo {
  return { name, label, numeric: true, nValid: 100, pctValid: 100, nDistinct: 4, labelled: true, weightLike: false, ...extra };
}

describe("planStarterTables", () => {
  const dict: VariableDictionary = {
    nCases: 100,
    variables: [
      v("Gender", "Gender of respondent", { nDistinct: 2 }),
      v("Age", "Age group", { nDistinct: 5 }),
      v("Province", "Province", { nDistinct: 9 }),
      v("Weight", "Person weight", { nDistinct: 90, weightLike: true }),
      v("Q1", "Do you bank?", { nDistinct: 3 }),
      v("Q2", "Free text comment", { numeric: false, text: true, nDistinct: 90, labelled: false }),
      v("Q3", "Only asked of a few", { pctValid: 10 }),
      v("Q4", "Too many answers", { nDistinct: 40 }),
    ],
    sets: [{ key: "M", kind: "multi", label: "Networks used", vars: ["M_1", "M_2"], nValid: 100, pctValid: 100 }],
  };

  it("picks demographic banners in a sensible order and a default weight", () => {
    const plan = planStarterTables(dict);
    expect(plan.banners.map((b) => b.name)).toEqual(["Gender", "Age", "Province"]);
    expect(plan.weightVar).toBe("Weight");
    expect(plan.small).toBe(true);
  });

  it("leaves out banners with too many categories, text, weights and thin questions", () => {
    const plan = planStarterTables(dict);
    const keys = plan.items.map((i) => i.key);
    expect(keys).toContain("M");
    expect(keys).toContain("Q1");
    expect(keys).not.toContain("Q2");
    expect(keys).not.toContain("Q3");
    expect(keys).not.toContain("Q4");
    expect(keys).not.toContain("Gender");
  });

  it("is smaller for big files", () => {
    const many = Array.from({ length: 300 }, (_, i) => v(`X${i}`, `Question ${i}`));
    const big: VariableDictionary = { nCases: 100, variables: [...dict.variables, ...many] };
    const plan = planStarterTables(big);
    expect(plan.small).toBe(false);
    expect(plan.items.length).toBe(20);
    expect(plan.eligibleQuestions).toBeGreaterThan(20);
  });
});
