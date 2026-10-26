import { describe, expect, it } from "vitest";
import { checkAtom, fromGeneric, parseNumber, resolveRow } from "../tableClaims";

const rows = [
  { Answer: "Uses mobile banking", Women: "62%", Men: "48%", Total: "55%" },
  { Answer: "Satisfied", Women: 40, Men: 41, Total: 40 },
  { Answer: "Base (n)", Women: 400, Men: 380, Total: 780 },
];
const t = fromGeneric("t1", "d1", "Banking use (%)", ["Answer", "Women", "Men", "Total"], rows);

describe("parseNumber", () => {
  it("reads figures and decimals", () => {
    expect(parseNumber("43%")).toMatchObject({ value: 43, pct: true, decimals: 0 });
    expect(parseNumber("12.5 percent")).toMatchObject({ value: 12.5, pct: true, decimals: 1 });
    expect(parseNumber("1,250")).toMatchObject({ value: 1250 });
    expect(parseNumber("none")).toBeNull();
  });
});

describe("generic table view", () => {
  it("finds rows, leaves out the base row, reads bases", () => {
    expect(t.rows.includes("Base (n)")).toBe(false);
    expect(resolveRow(t, "mobile banking")).toBe("Uses mobile banking");
    expect(t.cell("Uses mobile banking", "Women")).toEqual({ value: 62, base: 400, se: null, measure: "percent" });
  });
});

describe("tier a: stated figure", () => {
  it("matches within rounding and flags a mismatch", () => {
    const ok = checkAtom(t, { kind: "level", row: "mobile banking", col: "Women", statedText: "62%" })[0];
    expect(ok.tier).toBe("a");
    expect(ok.stance).toBe("supports");
    const bad = checkAtom(t, { kind: "level", row: "mobile banking", col: "Women", statedText: "68%" })[0];
    expect(bad.stance).toBe("against");
    const r = checkAtom(t, { kind: "level", row: "mobile banking", col: "Total", statedText: "55.4%" })[0];
    expect(r.stance).toBe("against");
  });
  it("says silent when the row is not there", () => {
    const r = checkAtom(t, { kind: "level", row: "crypto", col: "Women", statedText: "5%" })[0];
    expect(r.stance).toBe("silent");
    expect(r.check).toBe("locate");
  });
});

describe("tier b: re-derived tests", () => {
  it("supports a real gap in the stated direction", () => {
    const r = checkAtom(t, { kind: "comparison", row: "mobile banking", colA: "Women", colB: "Men", direction: "a_higher" })[0];
    expect(r.tier).toBe("b");
    expect(r.stance).toBe("supports");
  });
  it("is against when it runs the other way", () => {
    const r = checkAtom(t, { kind: "comparison", row: "mobile banking", colA: "Women", colB: "Men", direction: "b_higher" })[0];
    expect(r.stance).toBe("against");
  });
  it("is inconclusive for a small gap and flags a significance claim", () => {
    const small = fromGeneric("t2", "d1", "Use (%)", ["Answer", "A", "B"], [
      { Answer: "Yes", A: "51%", B: "49%" },
      { Answer: "Base", A: 200, B: 200 },
    ]);
    const r = checkAtom(small, { kind: "comparison", row: "Yes", colA: "A", colB: "B", direction: "a_higher", claimsSignificant: true })[0];
    expect(r.stance).toBe("inconclusive");
    expect(r.summary.includes("does not confirm")).toBe(true);
  });
  it("is silent without a base or when the figures are not percentages", () => {
    const nb = fromGeneric("t3", "d1", "Use (%)", ["Answer", "A", "B"], [{ Answer: "Yes", A: "60%", B: "40%" }]);
    expect(checkAtom(nb, { kind: "comparison", row: "Yes", colA: "A", colB: "B", direction: "a_higher" })[0].stance).toBe("silent");
    const avg = fromGeneric("t4", "d1", "Average score", ["Item", "A", "B"], [{ Item: "Satisfaction", A: 7.2, B: 6.8 }, { Item: "Base", A: 200, B: 200 }]);
    expect(checkAtom(avg, { kind: "comparison", row: "Satisfaction", colA: "A", colB: "B", direction: "a_higher" })[0].stance).toBe("silent");
  });
  it("tests a level against a threshold", () => {
    const r = checkAtom(t, { kind: "level", row: "mobile banking", col: "Women", threshold: 50, direction: "above" })[0];
    expect(r.stance).toBe("supports");
    const r2 = checkAtom(t, { kind: "level", row: "mobile banking", col: "Men", threshold: 50, direction: "above" })[0];
    expect(r2.stance).toBe("inconclusive");
  });
});
