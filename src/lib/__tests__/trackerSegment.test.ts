// R5 segment: the pure rules of trackerSegment.ts. The figures themselves are proved against the engine in
// trackerSegment.db.test.ts; here the boundary check, the profile question list, the filter shape and the cross-wave
// identity rule.
import { describe, expect, it, vi } from "vitest";

vi.mock("../crosstabs", () => ({ computeCrosstab: vi.fn() }));
const { parseSegment, resolveSegment, segmentAgainstWave, segmentQuestionsOf, withSegment, segmentFilters, segmentFailure } = await import("../trackerSegment");
import type { RoleVariable, TrackerRecognition } from "../trackerRoles";

const v = (name: string, label: string, labels?: Record<string, string>, extra: Partial<RoleVariable> = {}): RoleVariable => ({ name, label, numeric: true, ...(labels ? { valueLabels: labels } : {}), ...extra });
const rec = (over: Partial<TrackerRecognition> = {}): TrackerRecognition =>
  ({
    type: "brand",
    frame: { brands: [], nonBrandCodes: [], questions: ["main_brand"] },
    measures: [],
    grids: [],
    otherLists: [],
    categoryMoments: { status: "not_found", reason: "" },
    advertisingRecall: { status: "not_found", reason: "" },
    ageGroups: { status: "not_found", reason: "" },
    mediaUse: { status: "not_found", reason: "" },
    decisionStyle: { status: "found", variable: "decision_style", label: "Decision style" },
    acquisitionChannel: { status: "found", variable: "acquisition_channel", label: "Most recent acquisition channel" },
    csm: { overallSatisfaction: null, recommend0to10: null, likelyToStay: null, likelyToSwitch: null, drivers: [], company: null },
    questions: [],
    ...over,
  }) as TrackerRecognition;

const VARS = [
  v("age", "Age"),
  v("gender", "Gender", { "1": "Man", "2": "Woman", "9": "Prefer not to say" }),
  v("age_band", "Age group", { "2": "25-34", "1": "18-24" }),
  v("income", "Monthly household income", { "1": "Low", "2": "High" }),
  v("main_brand", "Brand of main vehicle (region)", { "1": "Toyota", "2": "BMW" }),
  v("acquisition_channel", "Most recent acquisition channel", { "1": "Dealer", "2": "Online" }),
  v("decision_style", "Decision style", { "1": "A", "2": "B" }),
  v("media_region", "Region media", { "0": "No", "1": "Yes" }, { group: "media" }),
  v("province_text", "Province", undefined, { text: true }),
];

describe("trackerSegment (R5)", () => {
  it("profile questions: recognised by the one demographic rule, with an answer list, asked once, never a tracker role; gender then age then income", () => {
    expect(segmentQuestionsOf(VARS, rec()).map((q) => q.variable)).toEqual(["gender", "age_band", "income"]);
    expect(segmentQuestionsOf(VARS, rec()).find((q) => q.variable === "age_band")!.answers).toEqual([{ code: "1", label: "18-24" }, { code: "2", label: "25-34" }]);
  });

  it("the server boundary: shapes refused with the reason, duplicates of a code dropped, none is no segment", () => {
    expect(parseSegment(null)).toEqual({ ok: true, segment: null });
    expect(parseSegment({ questions: [] })).toEqual({ ok: true, segment: null });
    expect(parseSegment({ questions: [{ variable: "gender", codes: ["2", "2"] }] })).toEqual({ ok: true, segment: { questions: [{ variable: "gender", codes: ["2"] }] } });
    for (const bad of ["x", [], { questions: [{ variable: "gender", codes: [] }] }, { questions: [{ variable: "gender", codes: [2] }] }, { questions: [{ variable: "gender", codes: ["1"] }, { variable: "gender", codes: ["2"] }] }])
      expect(parseSegment(bad).ok, JSON.stringify(bad)).toBe(false);
    expect(parseSegment({ questions: Array.from({ length: 5 }, (_, i) => ({ variable: `q${i}`, codes: ["1"] })) })).toEqual({ ok: false, error: "A segment can use at most 4 questions." });
  });

  it("resolve: codes by identity, labels from the file; a variable or code the file lacks is the reason, never dropped", () => {
    const qs = segmentQuestionsOf(VARS, rec());
    const r = resolveSegment({ questions: [{ variable: "gender", codes: ["2"] }, { variable: "age_band", codes: ["2", "1"] }] }, qs, VARS);
    expect(r).toEqual({ ok: true, applied: { questions: [{ variable: "gender", label: "Gender", answers: [{ code: "2", label: "Woman" }] }, { variable: "age_band", label: "Age group", answers: [{ code: "1", label: "18-24" }, { code: "2", label: "25-34" }] }], text: "Woman; 18-24 or 25-34" } });
    expect(resolveSegment({ questions: [{ variable: "gender", codes: ["3"] }] }, qs, VARS)).toEqual({ ok: false, reason: "Answer code 3 is not in the answer list of Gender (gender) in this file." });
    expect(resolveSegment({ questions: [{ variable: "region", codes: ["1"] }] }, qs, VARS)).toEqual({ ok: false, reason: "The segment question region is not in this file." });
    expect(resolveSegment({ questions: [{ variable: "decision_style", codes: ["1"] }] }, qs, VARS)).toMatchObject({ ok: false, reason: expect.stringMatching(/not a profile question/) });
  });

  it("the engine filter: one raw-code filter per question, after the request's own filters", () => {
    const qs = segmentQuestionsOf(VARS, rec());
    const r = resolveSegment({ questions: [{ variable: "gender", codes: ["2"] }, { variable: "age_band", codes: ["1", "2"] }] }, qs, VARS);
    if (!r.ok) throw new Error(r.reason);
    const req = withSegment({ columnVars: [], rowItems: [], weightVar: null, filters: [{ variable: "aware_b08", op: "between", min: 1, max: 1 }] }, r.applied);
    expect(req.filters).toEqual([{ variable: "aware_b08", op: "between", min: 1, max: 1 }, { variable: "gender", op: "codes", codes: ["2"] }, { variable: "age_band", op: "codes", codes: ["1", "2"] }]);
    expect(withSegment({ columnVars: [], rowItems: [], weightVar: null }, null).filters).toBeUndefined();
    expect(segmentFilters(null)).toEqual([]);
    expect(segmentFailure(new Error("No cases satisfy the filter: Gender is code 2."), r.applied)).toMatch(/No respondent in this file is in the segment Woman; 18-24 or 25-34 \(n=0\)/);
    expect(segmentFailure(new Error("No cases satisfy the filter"), null)).toBe("No cases satisfy the filter");
  });

  it("across waves: a question or code missing, or a code naming another answer, withholds the comparison with the reason", () => {
    const qs = segmentQuestionsOf(VARS, rec());
    const r = resolveSegment({ questions: [{ variable: "gender", codes: ["2"] }] }, qs, VARS);
    if (!r.ok || !r.applied) throw new Error("expected a segment");
    expect(segmentAgainstWave(r.applied, qs)).toBeNull();
    const relabelled = segmentQuestionsOf([v("gender", "Gender", { "1": "Man", "2": "Man (old)" })], rec());
    expect(segmentAgainstWave(r.applied, relabelled)).toBe("Gender answer code 2 was Man (old) in the previous wave, so it is not compared. The segment cannot be applied to that wave.");
    expect(segmentAgainstWave(r.applied, segmentQuestionsOf([v("gender", "Gender", { "1": "Man", "3": "Other" })], rec()))).toMatch(/Gender answer code 2 is not in the previous wave's answer list of Gender/);
    expect(segmentAgainstWave(r.applied, [])).toMatch(/is not a profile question with an answer list in that wave/);
  });
});
