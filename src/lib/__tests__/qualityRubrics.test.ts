import { describe, expect, it } from "vitest";
import {
  objectiveRating,
  objectiveScoresCurrent,
  parseObjectiveScores,
  parseRecommendationScores,
  recommendationRating,
} from "../qualityRubrics";

describe("ratings", () => {
  it("rates objectives out of 20", () => {
    expect(objectiveRating(20)).toBe("strong");
    expect(objectiveRating(16)).toBe("strong");
    expect(objectiveRating(15)).toBe("workable");
    expect(objectiveRating(12)).toBe("workable");
    expect(objectiveRating(11)).toBe("weak");
  });

  it("rates recommendations out of 15", () => {
    expect(recommendationRating(15)).toBe("strong");
    expect(recommendationRating(12)).toBe("strong");
    expect(recommendationRating(11)).toBe("workable");
    expect(recommendationRating(9)).toBe("workable");
    expect(recommendationRating(7)).toBe("weak");
  });
});

const obj = (over: Record<string, unknown> = {}) => ({
  index: 0,
  specific_score: 5,
  measurable_score: 3,
  answerable_score: 3,
  relevant_score: 5,
  rationale: "Measure is implied but no threshold.",
  suggestion: "Say what share would count as enough.",
  ...over,
});

describe("parseObjectiveScores", () => {
  it("keeps valid scores", () => {
    const out = parseObjectiveScores([obj(), obj({ index: 1 })], 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ specific: 5, measurable: 3, relevant: 5 });
  });

  it("drops bad values, bad indexes, missing rationale and duplicates", () => {
    const out = parseObjectiveScores(
      [
        obj({ specific_score: 4 }),
        obj({ index: 5 }),
        obj({ index: -1 }),
        obj({ rationale: "  " }),
        obj({ index: 1 }),
        obj({ index: 1, specific_score: 1 }),
        null,
      ],
      2,
    );
    expect(out.map((o) => o.index)).toEqual([1]);
    expect(out[0].specific).toBe(5);
  });

  it("allows a missing suggestion and rejects a non-array", () => {
    expect(
      parseObjectiveScores([obj({ suggestion: undefined })], 1)[0].suggestion,
    ).toBe("");
    expect(parseObjectiveScores("x", 1)).toEqual([]);
  });
});

describe("parseRecommendationScores", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    index: 0,
    actionability_score: 5,
    feasibility_score: 3,
    evidence_score: 3,
    impact_score: 1,
    rationale: "Owner is named but the timeline is open.",
    ...over,
  });

  it("keeps valid scores including impact", () => {
    const out = parseRecommendationScores([rec()], 1);
    expect(out[0]).toMatchObject({
      actionability: 5,
      feasibility: 3,
      evidence: 3,
      impact: 1,
    });
  });

  it("drops anything missing impact or with an invalid value", () => {
    expect(
      parseRecommendationScores([rec({ impact_score: undefined })], 1),
    ).toEqual([]);
    expect(
      parseRecommendationScores([rec({ feasibility_score: 2 })], 1),
    ).toEqual([]);
    expect(parseRecommendationScores([rec({ index: 1 })], 1)).toEqual([]);
  });
});

describe("objectiveScoresCurrent", () => {
  const stored = [
    { item_order: 0, item_text: "A" },
    { item_order: 1, item_text: "B" },
  ];
  it("is true only when every item matches in order", () => {
    expect(objectiveScoresCurrent(["A", "B"], stored)).toBe(true);
    expect(objectiveScoresCurrent(["A", "C"], stored)).toBe(false);
    expect(objectiveScoresCurrent(["A"], stored)).toBe(false);
    expect(objectiveScoresCurrent([], [])).toBe(false);
  });
});
