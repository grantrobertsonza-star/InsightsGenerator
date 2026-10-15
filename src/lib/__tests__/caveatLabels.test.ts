import { describe, expect, it } from "vitest";
import { CAVEAT_LABELS, EXPORT_CAVEAT_ALLOWLIST, caveatLabel, exportCaveatLabels } from "../caveatLabels";

describe("caveatLabel", () => {
  it("returns the known label for a recognised tag", () => {
    expect(caveatLabel("survey_design_modelled")).toBe("Survey design modelled (Taylor series)");
  });
  it("falls back to an underscore-replaced version of an unrecognised tag, never silently drops it", () => {
    expect(caveatLabel("some_future_tag")).toBe("some future tag");
  });
});

describe("exportCaveatLabels", () => {
  it("returns [] for null, undefined, or empty input", () => {
    expect(exportCaveatLabels(null)).toEqual([]);
    expect(exportCaveatLabels(undefined)).toEqual([]);
    expect(exportCaveatLabels([])).toEqual([]);
  });

  // FND-001/REP-OUT-001 (second counter-review): internal bookkeeping tags are meaningful in
  // the app's own review screens (CAVEAT_LABELS has an entry for them) but must never reach a
  // client-facing export - only the narrow allow-list the counter-review named does.
  it("drops every tag not on the export allow-list, even ones CAVEAT_LABELS itself recognises", () => {
    expect(exportCaveatLabels(["descriptive_reading", "weighted_effective_base", "base_size_small"])).toEqual([]);
  });

  it("surfaces each allow-listed tag, humanised", () => {
    expect(exportCaveatLabels(["survey_design_not_modelled"])).toEqual(["Survey design not modelled"]);
    expect(exportCaveatLabels(["stage_ratio_population_comparability_unverified"])).toEqual([
      "Stage ratio: equivalent population not established",
    ]);
  });

  it("keeps only the allow-listed tags out of a mixed list", () => {
    expect(
      exportCaveatLabels([
        "descriptive_reading",
        "survey_design_missing_for_some_cases",
        "base_size_small",
        "survey_design_candidates_ambiguous",
      ]),
    ).toEqual(["Design info missing for some cases", "Design candidates ambiguous"]);
  });

  // The real-world case this exists for: a synthesized insight built from several contributing
  // findings that each independently carry the same caveat tag must render ONE line, not one per
  // source.
  it("de-duplicates repeated allow-listed tags across multiple contributing findings", () => {
    expect(
      exportCaveatLabels([
        "survey_design_not_modelled",
        "survey_design_not_modelled",
        "stage_ratio_population_comparability_unverified",
      ]),
    ).toEqual(["Survey design not modelled", "Stage ratio: equivalent population not established"]);
  });

  it("the allow-list is exactly the four tags named by the counter-review, no wider", () => {
    expect(Array.from(EXPORT_CAVEAT_ALLOWLIST).sort()).toEqual(
      [
        "stage_ratio_population_comparability_unverified",
        "survey_design_candidates_ambiguous",
        "survey_design_missing_for_some_cases",
        "survey_design_not_modelled",
      ].sort(),
    );
  });

  it("every allow-listed tag has a human label in CAVEAT_LABELS (no silent underscore fallback in practice)", () => {
    for (const tag of EXPORT_CAVEAT_ALLOWLIST) {
      expect(CAVEAT_LABELS[tag]).toBeDefined();
    }
  });
});
