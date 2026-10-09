import { describe, expect, it } from "vitest";
import { suggestBannerPlan } from "../bannerPlanSuggest";

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    RespondentID: `R${i}`,
    Wave: "Wave1",
    Segment: ["A", "B", "C"][i % 3],
    Billing: i % 4 === 0 ? 1 : 0,
    Score: (i % 5) + 1,
    Comment: `free text ${i}`,
  }));
}

describe("suggestBannerPlan", () => {
  it("picks small text groups as banner and numeric columns as stub", () => {
    const plan = suggestBannerPlan(
      ["RespondentID", "Wave", "Segment", "Billing", "Score", "Comment"],
      makeRows(300),
    );
    expect(plan).toEqual({ banner: ["Segment"], stub: ["Billing", "Score"] });
  });

  it("returns null for a small table or one with no usable banner", () => {
    expect(suggestBannerPlan(["Segment", "Score"], makeRows(10))).toBeNull();
    const rows = makeRows(300).map((r) => ({ ...r, Segment: "A" }));
    expect(suggestBannerPlan(["Segment", "Score"], rows)).toBeNull();
  });
});
