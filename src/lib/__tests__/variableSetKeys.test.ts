import { describe, expect, it } from "vitest";
import { hasRepeatedSetKeys, setChoicesToCheck } from "../variableSetKeys";

describe("question-set keys", () => {
  it("finds a repeated key, and none in a clean or missing list", () => {
    expect(hasRepeatedSetKeys([{ key: "EN9" }, { key: "Q2" }, { key: "EN9" }])).toBe(true);
    expect(hasRepeatedSetKeys([{ key: "EN9" }, { key: "EN9 (battery)" }])).toBe(false);
    expect(hasRepeatedSetKeys(undefined)).toBe(false);
    // A stored row whose sets are not a list (JSON from an older or hand-made row) is not rebuilt for this.
    expect(hasRepeatedSetKeys({} as unknown as { key: string }[])).toBe(false);
  });
  it("asks to check a saved choice only where its stem now also has a set keyed apart", () => {
    const sets = [{ key: "EN9" }, { key: "EN9 (battery)" }, { key: "Q2" }, { key: "Q7" }, { key: "Q7 (grid)" }];
    expect(setChoicesToCheck(["EN9", "Q2", "Q7", "EN9"], sets)).toEqual(["EN9", "Q7"]);
    expect(setChoicesToCheck(["Gone"], sets)).toEqual([]);
  });
});
