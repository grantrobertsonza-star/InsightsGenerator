import { describe, expect, it } from "vitest";
import { computeAggregatedQuality, toNumber } from "../aggregatedQuality";

const t = (label: string, headers: string[], rows: Record<string, string | number>[]) => ({ label, headers, rows });

describe("toNumber", () => {
  it("reads percentages, thousands and dashes", () => {
    expect(toNumber("45%")).toBe(45);
    expect(toNumber("1,234")).toBe(1234);
    expect(toNumber("-")).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });
});

describe("computeAggregatedQuality", () => {
  const good = t("Use", ["Answer", "Male", "Female"], [
    { Answer: "Base (n)", Male: 120, Female: 8 },
    { Answer: "Yes", Male: "60%", Female: "50%" },
    { Answer: "No", Male: "40%", Female: "50%" },
  ]);

  it("finds bases and small ones", () => {
    const q = computeAggregatedQuality([good]);
    expect(q.withBase).toBe(1);
    expect(q.bases.min).toBe(8);
    expect(q.bases.under10).toBe(1);
    expect(q.percentColumns.addTo100).toBe(2);
  });

  it("flags a table with no base", () => {
    const q = computeAggregatedQuality([t("X", ["A", "B"], [{ A: "a", B: "1%" }, { A: "b", B: "2%" }])]);
    expect(q.checks.find((c) => c.id === "base")?.status).toBe("fail");
  });

  it("reads a base from n= in a heading", () => {
    const q = computeAggregatedQuality([t("X", ["A", "Men (n=250)", "Women (n=300)"], [{ A: "a", "Men (n=250)": "50%", "Women (n=300)": "50%" }, { A: "b", "Men (n=250)": "50%", "Women (n=300)": "50%" }])]);
    expect(q.bases.count).toBe(2);
    expect(q.bases.min).toBe(250);
  });

  it("warns on near-miss percentage sums, tolerates rounding", () => {
    const q = computeAggregatedQuality([
      t("R", ["A", "C1", "C2"], [
        { A: "a", C1: "50%", C2: "50%" },
        { A: "b", C1: "49%", C2: "41%" },
      ]),
    ]);
    expect(q.percentColumns.addTo100).toBe(1);
    expect(q.percentColumns.nearMiss).toBe(1);
    expect(q.checks.find((c) => c.id === "percent_sums")?.status).toBe("warn");
  });

  it("checks counts against a total row", () => {
    const q = computeAggregatedQuality([
      t("N", ["A", "C1"], [
        { A: "a", C1: 100 },
        { A: "b", C1: 150 },
        { A: "Total", C1: 300 },
      ]),
    ]);
    expect(q.totals.checkable).toBe(1);
    expect(q.totals.mismatched).toBe(1);
  });

  it("finds duplicate tables and weighting wording", () => {
    const q = computeAggregatedQuality([good, good, t("Unweighted base", ["A", "B"], [{ A: "x", B: 1 }, { A: "y", B: 2 }])]);
    expect(q.duplicateTables).toBe(1);
    expect(q.weightingStated.unweighted).toBe(true);
  });
});
