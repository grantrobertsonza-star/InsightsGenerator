import { describe, expect, it } from "vitest";
import {
  computeTableQuality,
  inferVariableType,
  isMissing,
  isUnlabelledHeader,
} from "../dataQuality";

describe("isMissing", () => {
  it("treats null, blanks, NaN and NA-style tokens as missing, and zero as present", () => {
    expect(isMissing(null)).toBe(true);
    expect(isMissing(undefined)).toBe(true);
    expect(isMissing("")).toBe(true);
    expect(isMissing("  ")).toBe(true);
    expect(isMissing("N/A")).toBe(true);
    expect(isMissing("na")).toBe(true);
    expect(isMissing(Number.NaN)).toBe(true);
    expect(isMissing(0)).toBe(false);
    expect(isMissing("0")).toBe(false);
    expect(isMissing("Yes")).toBe(false);
  });
});

describe("isUnlabelledHeader", () => {
  it("flags bare codes and blanks but not descriptive names", () => {
    expect(isUnlabelledHeader("Q12")).toBe(true);
    expect(isUnlabelledHeader("VAR00007")).toBe(true);
    expect(isUnlabelledHeader("Column3")).toBe(true);
    expect(isUnlabelledHeader("")).toBe(true);
    expect(isUnlabelledHeader("Age group")).toBe(false);
    expect(isUnlabelledHeader("Q12 satisfaction with service")).toBe(false);
  });
});

describe("computeTableQuality", () => {
  const headers = ["Age", "Region", "Q1"];
  const rows = [
    { Age: 30, Region: "North", Q1: 1 },
    { Age: 41, Region: "North", Q1: null },
    { Age: 41, Region: "North", Q1: null },
    { Age: null, Region: "North", Q1: "" },
  ];

  it("counts cases, variables, missing cells and per-variable missing", () => {
    const q = computeTableQuality(headers, rows, "raw");
    expect(q.cases).toBe(4);
    expect(q.variables).toBe(3);
    expect(q.cells).toBe(12);
    expect(q.missingCells).toBe(4);
    expect(q.missingPct).toBeCloseTo(33.3, 1);
    expect(q.worstVariables[0].name).toBe("Q1");
    expect(q.worstVariables[0].missingPct).toBe(75);
  });

  it("detects duplicates, constant and unlabelled variables on raw data", () => {
    const q = computeTableQuality(headers, rows, "raw");
    expect(q.duplicateCases).toBe(1);
    // Region is always North; Q1 has a single observed value (1) with the rest missing.
    expect(q.constantVariables).toBe(2);
    expect(q.unlabelledVariables).toBe(1);
  });

  it("skips case-level checks for aggregated tables", () => {
    const q = computeTableQuality(headers, rows, "aggregated");
    expect(q.duplicateCases).toBe(0);
    expect(q.checks.map((c) => c.id)).not.toContain("duplicates");
    expect(q.checks.map((c) => c.id)).not.toContain("sample_size");
  });

  it("marks a large clean sample as pass and a small one as a problem", () => {
    const big = Array.from({ length: 150 }, (_, i) => ({
      Age: i,
      Region: `r${i % 3}`,
      Q1: i % 2,
    }));
    expect(
      computeTableQuality(
        ["Age", "Region", "Q1"].map((h) => (h === "Q1" ? "Satisfaction" : h)),
        big.map((r) => ({ Age: r.Age, Region: r.Region, Satisfaction: r.Q1 })),
        "raw",
      ).status,
    ).toBe("pass");
    const small = big.slice(0, 10);
    expect(
      computeTableQuality(headers, small, "raw").checks.find(
        (c) => c.id === "sample_size",
      )?.status,
    ).toBe("fail");
  });

  it("handles an empty table without dividing by zero", () => {
    const q = computeTableQuality([], [], "raw");
    expect(q.missingPct).toBe(0);
    expect(q.cases).toBe(0);
  });
});

describe("inferVariableType", () => {
  it("reads text and two-value numbers as categorical", () => {
    expect(inferVariableType(["North", "South", "North"])).toBe("categorical");
    expect(inferVariableType([0, 1, 1, 0])).toBe("categorical");
    expect(inferVariableType([null, ""])).toBe("categorical");
  });

  it("reads small whole-number scales as discrete", () => {
    expect(inferVariableType([1, 2, 3, 4, 5, 3, 2])).toBe("discrete");
    expect(inferVariableType(["1", "2", "3", "4"])).toBe("discrete");
  });

  it("reads decimals and wide whole-number ranges as continuous", () => {
    expect(inferVariableType([1.5, 2.25, 3.1])).toBe("continuous");
    expect(inferVariableType(Array.from({ length: 30 }, (_, i) => i))).toBe(
      "continuous",
    );
  });

  it("counts types across a table", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      Region: i % 3 ? "N" : "S",
      Rating: (i % 5) + 1,
      Income: i * 100.5,
    }));
    const q = computeTableQuality(["Region", "Rating", "Income"], rows, "raw");
    expect(q.typeCounts).toEqual({
      categorical: 1,
      discrete: 1,
      continuous: 1,
    });
  });
});

describe("survey routing", () => {
  // 200 respondents. "Has account" is the gate; "Account type" is asked only
  // of those who have one. "Opinion" is empty at random, which is a real gap.
  const rows = Array.from({ length: 200 }, (_, i) => {
    const has = i % 2 === 0 ? "Yes" : "No";
    return {
      Gate: has,
      Routed: has === "Yes" ? ["A", "B", "C"][i % 3] : null,
      Opinion: i % 5 < 2 ? null : (i % 4) + 1,
      Size: (i % 7) + 1,
    };
  });
  const q = computeTableQuality(["Gate", "Routed", "Opinion", "Size"], rows, "raw");

  it("names the gate question when empty answers follow a routing pattern", () => {
    const routed = q.variableDetails.find((v) => v.name === "Routed")!;
    expect(routed.missingPct).toBe(50);
    expect(routed.routedBy).toBe("Gate");
    expect(q.routedVariables).toBe(1);
  });

  it("still flags gaps that nothing explains", () => {
    const opinion = q.variableDetails.find((v) => v.name === "Opinion")!;
    expect(opinion.missingPct).toBe(40);
    expect(opinion.routedBy).toBeFalsy();
    const check = q.checks.find((c) => c.id === "missing_by_variable")!;
    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/by routing/);
  });

  it("does not turn a routed file into a problem", () => {
    const onlyRouted = rows.map((r) => ({ Gate: r.Gate, Routed: r.Routed, Size: r.Size }));
    const r = computeTableQuality(["Gate", "Routed", "Size"], onlyRouted, "raw");
    expect(r.checks.find((c) => c.id === "missing_by_variable")!.status).toBe("pass");
    expect(r.checks.find((c) => c.id === "missing_overall")!.status).toBe("pass");
  });

  it("does not look for routing in tiny tables", () => {
    const small = computeTableQuality(["Gate", "Routed"], rows.slice(0, 20), "raw");
    expect(small.routedVariables).toBe(0);
  });
});
