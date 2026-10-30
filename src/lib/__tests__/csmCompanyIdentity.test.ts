// Codex E1-F01: csmChangesAgainst compares a company only when its code is the same company in both waves (the
// identity rule codeNamesDiffer, shared with the brand funnel). Unchanged identity, a reassigned code, unknown companies
// in either wave, a changed company question, and recovery once the mapping names the same company again.
import { describe, expect, it, vi } from "vitest";

// Only the pure comparison is under test; the modules that calculate figures are not called.
vi.mock("../chartActions", () => ({ runDistributionAction: vi.fn() }));
vi.mock("../npsActions", () => ({ runNpsAction: vi.fn() }));
vi.mock("../drivers", () => ({ runDriverAnalysisFor: vi.fn() }));
vi.mock("../crosstabs", () => ({ computeCrosstab: vi.fn(), loadVariableDictionaryWithStatus: vi.fn() }));
vi.mock("../dataSetup", () => ({ loadDataSetupWithStatus: vi.fn() }));

const { csmChangesAgainst } = await import("../trackerCsmFigures");
type Tiles = Parameters<typeof csmChangesAgainst>[0];

const stay = (box: number, mean: number, label: string): Tiles => [
  { id: "stay", status: "ok", variable: "continue5", label: "Continue", mean: 4, scaleTop: 5, box: 50, boxCodes: "4, 5", effectiveBase: 100, byCompany: [{ code: "1", label, mean, box, effectiveBase: 50 }] },
];
const companies = (label: string, variable = "company") => ({ variable, companies: [{ code: "1", label }] });

describe("CSM company changes need the same company in both waves", () => {
  it("same code, same company: compared (control)", () => {
    const [all, fnb] = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "FNB"), "", { current: companies("FNB"), previous: companies(" fnb ") });
    expect(all).toMatchObject({ code: null, changePp: 0 });
    expect(fnb.changePp).toBeCloseTo(20, 9);
    expect(fnb.meanChange).toBeCloseTo(0.3, 9);
    expect(fnb.reason).toBeUndefined();
  });
  it("code reused for another company: no box or mean change, with the reason (Codex's repro: +20 points before)", () => {
    const [all, fnb] = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "Capitec"), "", { current: companies("FNB"), previous: companies("Capitec") });
    expect(all.changePp).toBe(0);
    expect(fnb).toMatchObject({ code: "1", previous: null, changePp: null, meanChange: null, reason: "Company code 1 was Capitec in the compared wave, so it is not compared." });
  });
  it("companies unknown in either wave: not compared, never assumed the same", () => {
    for (const ctx of [null, { current: companies("FNB"), previous: null }, { current: null, previous: companies("FNB") }]) {
      const fnb = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "FNB"), "", ctx)[1];
      expect(fnb).toMatchObject({ changePp: null, meanChange: null, reason: "Which company each code named in one of the two waves is not known, so companies are not compared." });
    }
  });
  it("a different company question in the previous wave: not compared, with the question named", () => {
    const fnb = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "FNB"), "", { current: companies("FNB"), previous: companies("FNB", "main_bank") })[1];
    expect(fnb).toMatchObject({ changePp: null, reason: "The previous wave used a different company question (main_bank), so companies are not compared." });
  });
  it("a code missing from the previous wave's company list: not compared", () => {
    const fnb = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "FNB"), "", { current: companies("FNB"), previous: { variable: "company", companies: [] } })[1];
    expect(fnb).toMatchObject({ changePp: null, reason: "Company code 1 is not in the compared wave's company list." });
  });
  it("recovery: the same inputs with the mapping corrected compare again", () => {
    const wrong = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "Capitec"), "", { current: companies("FNB"), previous: companies("Capitec") })[1];
    const fixed = csmChangesAgainst(stay(60, 4.2, "FNB"), stay(40, 3.9, "FNB"), "", { current: companies("FNB"), previous: companies("FNB") })[1];
    expect([wrong.changePp, fixed.changePp]).toEqual([null, 20]);
  });
});
