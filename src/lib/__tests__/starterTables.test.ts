import { describe, expect, it } from "vitest";
import { chosenBannersProblem, planStarterTables } from "../starterTables";
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

  // Grant, 2026-10-22: a call-centre tracker (csm_Wave1_Baseline) split only by Segment had no
  // starter set. Shape of that file: one grouping column, Yes/No call events, 0 to 10 ratings, a
  // one-value Wave column.
  const tracker: VariableDictionary = {
    nCases: 1000,
    variables: [
      v("RespondentID", "RespondentID", { numeric: false, text: true, nDistinct: 1000, labelled: false }),
      v("Wave", "Wave", { nDistinct: 1 }),
      // Stored as text answers with no value labels, as in the spreadsheet.
      v("Segment", "Segment", { nDistinct: 3, numeric: false, text: true, labelled: false, nValid: 1000 }),
      v("Transferred", "Transferred", { nDistinct: 2, numeric: false, text: true, labelled: false, nValid: 1000 }),
      v("ActualWaitTimeBand", "ActualWaitTimeBand", { nDistinct: 9, numeric: false, text: true, labelled: false, nValid: 1000 }),
      v("AgentAssurance_Attitude_0to10", "AgentAssurance_Attitude_0to10", { nDistinct: 11 }),
      v("WaitTimeVsExpectation", "WaitTimeVsExpectation", { nDistinct: 5, numeric: false, text: true, labelled: false, nValid: 1000 }),
      v("Comment", "Comment", { nDistinct: 700, numeric: false, text: true, labelled: false, nValid: 900 }),
    ],
  };

  it("recognises a customer grouping such as Segment, after any demographic", () => {
    const plan = planStarterTables(tracker);
    expect(plan.banners.map((b) => b.name)).toEqual(["Segment"]);
    expect(plan.chosen).toBe(false);
    expect(plan.items.map((i) => i.key)).not.toContain("Segment");
    // Text answers in a short list are questions too; free text is not.
    expect(plan.items.map((i) => i.key)).toEqual(["Transferred", "ActualWaitTimeBand", "AgentAssurance_Attitude_0to10", "WaitTimeVsExpectation"]);
    // Not taken as banners: an agent rating ("Agent" is not "age"), a wait-time band, a one-value wave.
    const withGender = planStarterTables({ ...tracker, variables: [...tracker.variables, v("Gender", "Gender", { nDistinct: 2 })] });
    expect(withGender.banners.map((b) => b.name)).toEqual(["Gender", "Segment"]);
  });

  it("reads camel-case and underscored names as words", () => {
    const plan = planStarterTables({ nCases: 10, variables: [v("CustomerTier", "CustomerTier", { nDistinct: 3 }), v("age_group", "age_group", { nDistinct: 5 }), v("Q1", "Q1", { nDistinct: 3 })] });
    expect(plan.banners.map((b) => b.name)).toEqual(["age_group", "CustomerTier"]);
  });

  it("lists every banner candidate, recognised first, and builds from the researcher's choice", () => {
    const plan = planStarterTables(tracker);
    expect(plan.candidates.map((c) => c.name)).toEqual(["Segment", "Transferred", "ActualWaitTimeBand", "WaitTimeVsExpectation"]);
    expect(plan.candidates[0].recognised).toBe(true);
    expect(plan.candidates.slice(1).every((c) => !c.recognised)).toBe(true);
    const mine = planStarterTables(tracker, ["Transferred", "WaitTimeVsExpectation"]);
    expect(mine.chosen).toBe(true);
    expect(mine.banners.map((b) => b.name)).toEqual(["Transferred", "WaitTimeVsExpectation"]);
    expect(mine.items.map((i) => i.key)).toContain("Segment");
    expect(mine.items.map((i) => i.key)).not.toContain("Transferred");
    // Nothing chosen: no banners, so nothing is built.
    expect(planStarterTables(tracker, []).banners).toEqual([]);
  });

  it("checks a chosen set of banners against the file", () => {
    expect(chosenBannersProblem(tracker, ["Segment"])).toBeNull();
    expect(chosenBannersProblem(tracker, [])).toMatch(/at least one/);
    expect(chosenBannersProblem(tracker, ["Segment", "Segment"])).toMatch(/twice/);
    expect(chosenBannersProblem(tracker, ["Segment", "Transferred", "ActualWaitTimeBand", "WaitTimeVsExpectation", "Wave"])).toMatch(/at most 4/);
    expect(chosenBannersProblem(tracker, ["AgentAssurance_Attitude_0to10"])).toMatch(/Not a column to split by.*AgentAssurance_Attitude_0to10/);
    expect(chosenBannersProblem(tracker, ["Wave"])).toMatch(/Not a column to split by/);
    expect(chosenBannersProblem(tracker, ["NoSuchColumn"])).toMatch(/NoSuchColumn/);
  });

  it("adds a mean row above the answers of a 10 or 11 point scale only", () => {
    const plan = planStarterTables(tracker);
    const groups = Object.fromEntries(plan.items.map((i) => [i.key, (i.groups ?? []).map((g) => g.kind)]));
    expect(groups.AgentAssurance_Attitude_0to10).toEqual(["mean"]);
    expect(groups.Transferred).toEqual([]);
    expect(groups.ActualWaitTimeBand).toEqual([]);
    expect(plan.meanScales).toBe(1);
    const scale = (n: number) => planStarterTables({ nCases: 10, variables: [v("Gender", "Gender", { nDistinct: 2 }), v("X", "X", { nDistinct: n })] }).items[0];
    expect(scale(9).groups).toBeUndefined();
    expect(scale(10).groups?.[0]).toMatchObject({ kind: "mean", place: "above", qualifyCodes: true });
    expect(scale(11).groups?.[0]).toMatchObject({ kind: "mean" });
    expect(scale(12).groups).toBeUndefined();
  });
});
