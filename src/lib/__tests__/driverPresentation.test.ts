import { describe, expect, it } from "vitest";
import type { DriverReport } from "../drivers";
import { driverSummary } from "../driverPresentation";

const report = (over: Partial<DriverReport["result"]> = {}, skipped: DriverReport["skipped"] = []): DriverReport =>
  ({
    request: {} as DriverReport["request"],
    outcomeLabel: "Satisfaction",
    outcomeNote: "",
    casesInFile: 5600,
    weighted: true,
    skipped,
    performance: [],
    result: {
      outcome: "continuous",
      n: 148,
      predictors: 4,
      fit: { rSquared: 0.012, adjRSquared: 0.004, mcFadden: null, nagelkerke: null, classificationRate: null, baseRate: null },
      method: "shapley",
      rows: [],
      warnings: [
        "5452 of 5600 cases had a missing value and were left out (complete cases only).",
        "These predictors explain under 10% of the variation in the outcome. The ranking says little about what drives it.",
      ],
      droppedPredictors: [],
      ...over,
    },
  }) as DriverReport;

describe("driver results summary", () => {
  it("leads with cases used of the file, the variation explained, exclusions and the engine's warnings", () => {
    const s = driverSummary(report({}, [{ variable: "Q9", reason: "every case gave the same answer" }]));
    expect(s.used).toBe(148);
    expect(s.inFile).toBe(5600);
    expect(s.usedShare).toBeCloseTo(148 / 5600, 6);
    expect(s.fitFigure).toBe("1%");
    expect(s.fitText).toMatch(/explain little/);
    expect(s.fitText).not.toMatch(/cause|drives|strong/i);
    expect(s.exclusions).toEqual(["Left out: Q9 (every case gave the same answer).", "5452 of 5600 cases had a missing value and were left out (complete cases only)."]);
    expect(s.limitations).toEqual(["These predictors explain under 10% of the variation in the outcome. The ranking says little about what drives it."]);
  });

  it("states a logistic fit as pseudo R-squared with its classification rate, and an unknown file size as unknown", () => {
    const s = driverSummary({ ...report({ fit: { rSquared: 0, adjRSquared: null, mcFadden: 0.031, nagelkerke: 0.05, classificationRate: 0.61, baseRate: 0.6 }, warnings: [] }), casesInFile: 0 });
    expect(s.fitFigure).toBe("0.03");
    expect(s.fitText).toBe("Pseudo R-squared (McFadden). The model classifies 61% of cases correctly, against 60% by always guessing the larger group.");
    expect(s.usedShare).toBeNull();
    expect(s.exclusions).toEqual([]);
    expect(s.limitations).toEqual([]);
  });
});
