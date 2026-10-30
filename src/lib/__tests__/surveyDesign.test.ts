import { describe, expect, it } from "vitest";
import { detectSurveyDesign, effectiveDesignChoice, resolveSurveyDesign } from "../surveyDesign";

const dictWith = (names: string[]) => ({ variables: names.map((name) => ({ name })) }) as never;

describe("resolveSurveyDesign", () => {
  it("resolves a PSU-only auto-detected design", () => {
    const resolved = resolveSurveyDesign(dictWith(["psu_code", "nps_score"]));
    expect(resolved).toEqual({
      design: { psu: "psu_code", strata: null },
      ambiguous: { psu: [], strata: [] },
      source: "auto",
    });
  });

  // ANA-NPS-003 (second counter-review): strata-only support stopped at the resolver before
  // this fix - a dictionary with a stratum variable and no PSU variable used to resolve to
  // "no design" even though the engine (api/parse-stats-file.py) is fully able to apply a
  // strata-only design.
  it("resolves a strata-only auto-detected design, not 'no design'", () => {
    const resolved = resolveSurveyDesign(dictWith(["stratum_region", "nps_score"]));
    expect(resolved.design).toEqual({ psu: null, strata: "stratum_region" });
    expect(resolved.source).toBe("auto");
  });

  it("resolves a strata-only EXPLICIT choice, not 'no design'", () => {
    const resolved = resolveSurveyDesign(dictWith(["nps_score"]), { psu: null, strata: "stratum_region" });
    expect(resolved.design).toEqual({ psu: null, strata: "stratum_region" });
    expect(resolved.source).toBe("explicit");
  });

  it("treats an explicit choice with neither psu nor strata as explicit no-design", () => {
    const resolved = resolveSurveyDesign(dictWith(["psu_code"]), { psu: null, strata: null });
    expect(resolved).toEqual({ design: null, ambiguous: { psu: [], strata: [] }, source: "explicit" });
  });

  it("treats an explicit null as no-design, overriding an otherwise-unambiguous heuristic match", () => {
    const resolved = resolveSurveyDesign(dictWith(["psu_code"]), null);
    expect(resolved).toEqual({ design: null, ambiguous: { psu: [], strata: [] }, source: "explicit" });
  });

  it("an explicit choice always wins over the heuristic, even when they disagree", () => {
    const resolved = resolveSurveyDesign(dictWith(["psu_code", "ea_other"]), { psu: "ea_other", strata: null });
    expect(resolved.design).toEqual({ psu: "ea_other", strata: null });
    expect(resolved.source).toBe("explicit");
  });

  it("surfaces ambiguous PSU candidates instead of guessing, while an unambiguous strata match still resolves", () => {
    const resolved = resolveSurveyDesign(dictWith(["psu_a", "psu_b", "stratum_region"]));
    expect(resolved.design).toEqual({ psu: null, strata: "stratum_region" });
    expect(resolved.ambiguous.psu).toEqual(["psu_a", "psu_b"]);
    expect(resolved.source).toBe("auto");
  });

  it("resolves to no design when nothing is detected and nothing was chosen", () => {
    const resolved = resolveSurveyDesign(dictWith(["nps_score", "segment"]));
    expect(resolved).toEqual({ design: null, ambiguous: { psu: [], strata: [] }, source: "none" });
  });
});

describe("effectiveDesignChoice", () => {
  it("a caller's own choice always wins, even an explicit null", () => {
    expect(effectiveDesignChoice({ mode: "explicit", psu: "a", strata: null }, null)).toBeNull();
    expect(effectiveDesignChoice(null, { psu: "caller_psu", strata: null })).toEqual({ psu: "caller_psu", strata: null });
  });

  it("falls through to the heuristic when there is no persisted setting and no caller choice", () => {
    expect(effectiveDesignChoice(null, undefined)).toBeUndefined();
    expect(effectiveDesignChoice(undefined, undefined)).toBeUndefined();
  });

  it("'auto' mode (never decided) falls through to the heuristic", () => {
    expect(effectiveDesignChoice({ mode: "auto", psu: null, strata: null }, undefined)).toBeUndefined();
  });

  it("'none' mode (explicitly no design) is honoured when the caller has no opinion", () => {
    expect(effectiveDesignChoice({ mode: "none", psu: null, strata: null }, undefined)).toBeNull();
  });

  it("'explicit' mode is honoured when the caller has no opinion", () => {
    expect(effectiveDesignChoice({ mode: "explicit", psu: "psu_code", strata: "stratum_region" }, undefined)).toEqual({
      psu: "psu_code",
      strata: "stratum_region",
    });
  });
});

describe("detectSurveyDesign", () => {
  it("resolves PSU and strata independently, not gated on each other", () => {
    expect(detectSurveyDesign(dictWith(["ea_code"]))).toMatchObject({ psu: "ea_code", strata: null });
    expect(detectSurveyDesign(dictWith(["stratum_region"]))).toMatchObject({ psu: null, strata: "stratum_region" });
  });
});
