// Scorecard short names: every criterion in the shipped criteria release has one, names are keyed by
// the stable id (not wording), and an unknown id falls back to the id itself rather than to blank.
import { describe, expect, it } from "vitest";
import criteria from "../../research-quality/criteria/RQC-2.json";
import { CRITERION_SHORT_LABEL, criterionShortLabel } from "../researchQualityPresentation";

describe("criterion short names", () => {
  it("names every criterion in the release, and nothing that is not in it", () => {
    const ids = criteria.criteria.map((c) => c.criterionId).sort();
    expect(Object.keys(CRITERION_SHORT_LABEL).sort()).toEqual(ids);
    for (const c of criteria.criteria) {
      const name = CRITERION_SHORT_LABEL[c.criterionId];
      expect(name.length, c.criterionId).toBeGreaterThan(2);
      expect(name.length, c.criterionId).toBeLessThan(c.assessmentQuestion.length);
    }
  });

  it("falls back to the id for a criterion it has no name for", () => {
    expect(criterionShortLabel("RQ-DESIGN-ALIGN")).toBe("Design fits objectives");
    expect(criterionShortLabel("RQ-NEW-ONE")).toBe("RQ-NEW-ONE");
  });
});
