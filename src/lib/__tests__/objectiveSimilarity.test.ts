// Placement of re-read suggestions beside the objective they likely restate (Grant, 2026-10-22).
// Placement only: the rule never merges or drops a line.
import { describe, expect, it } from "vitest";
import { likelyRestates, objectiveSimilarity, objectiveWords, SIMILARITY_THRESHOLD } from "../objectiveSimilarity";

describe("objectiveSimilarity", () => {
  it("compares content words, ignoring markers, case, punctuation, function words and a plural s", () => {
    expect([...objectiveWords("1. Measure the demand for Bundles.")]).toEqual(["measure", "demand", "bundle"]);
    expect(objectiveSimilarity("Measure rural demand for bundles", "measure demand for bundles in rural areas")).toBeCloseTo(4 / 5);
  });
  it("places a reworded line beside its match and a new one beside none; ties go to the earlier candidate", () => {
    const existing = [{ text: "Understand why customers switch provider" }, { text: "Measure rural demand for affordable mobile bundles" }];
    expect(likelyRestates("Understand the reasons customers switch provider", existing)?.text).toBe("Understand why customers switch provider");
    expect(likelyRestates("Test the family bundle offer", existing)).toBeNull();
    expect(likelyRestates("Grow share", [{ text: "Grow share" }, { text: "grow share." }])?.text).toBe("Grow share");
  });
  it("uses the stated threshold and treats empty text as unlike anything", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.5);
    expect(objectiveSimilarity("", "anything")).toBe(0);
    expect(likelyRestates("alpha beta", [{ text: "alpha gamma delta" }])).toBeNull(); // 1/4 < 0.5
  });
});
