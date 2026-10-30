import { describe, expect, it } from "vitest";
import { evidenceSummaryPoints } from "../decisionPresentation";

describe("evidenceSummaryPoints", () => {
  it("splits the summary into its sentences without splitting decimals, ranges or brackets", () => {
    const text =
      "Across analyses, the evidence converges on an access-use gap: most holders have an account, but a third report no digital activity. " +
      "The four-cluster segmentation (Structurally Excluded 28.5%, Digitally Enabled 12.9%), despite weak separation (silhouette ~0.22), reinforces this, with use rising from 42.5% to 93.4%.\n\n" +
      "Claims about causality are thin, e.g. no price data.";
    const points = evidenceSummaryPoints(text);
    expect(points).toEqual([
      "Across analyses, the evidence converges on an access-use gap: most holders have an account, but a third report no digital activity.",
      "The four-cluster segmentation (Structurally Excluded 28.5%, Digitally Enabled 12.9%), despite weak separation (silhouette ~0.22), reinforces this, with use rising from 42.5% to 93.4%.",
      "Claims about causality are thin, e.g. no price data.",
    ]);
    // Nothing is dropped or reworded.
    expect(points.join(" ")).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("keeps a one-sentence summary whole, and returns nothing for blank text", () => {
    expect(evidenceSummaryPoints("Use rises with readiness")).toEqual(["Use rises with readiness"]);
    expect(evidenceSummaryPoints("  \n ")).toEqual([]);
  });
});
