import { describe, expect, it } from "vitest";
import { driverFindings } from "../driverFindings";
import { findingBasis, codeVerdict } from "../findingBasis";
import type { DriverReport } from "../drivers";

function report(over: Partial<DriverReport["result"]["fit"]> = {}): DriverReport {
  const row = (name: string, rank: number, share: number, extra = {}) => ({
    name, rank, share, shareLow: share - 0.03, shareHigh: share + 0.03, rankLow: rank, rankHigh: rank,
    effect: 0.3, correlation: 0.5, coefficient: 0.4, pValue: 0.001, vif: 1.5, ...extra,
  });
  return {
    request: { outcome: "csat", outcomeType: "continuous", predictors: ["a", "b", "c", "d"] },
    outcomeLabel: "Overall satisfaction",
    outcomeNote: "",
    casesInFile: 500,
    weighted: false,
    skipped: [],
    performance: [],
    result: {
      outcome: "continuous", n: 480, predictors: 4,
      fit: { rSquared: 0.5, adjRSquared: 0.49, mcFadden: null, nagelkerke: null, classificationRate: null, baseRate: null, ...over },
      method: "shapley",
      rows: [
        row("Speed of service", 1, 0.4),
        row("Staff helpfulness", 2, 0.3, { rankLow: 1, rankHigh: 3, vif: 6.1 }),
        row("Value for money", 3, 0.28),
        row("Branch cleanliness", 4, 0.02, { pValue: 0.4 }),
      ],
      warnings: [], droppedPredictors: [],
    },
  };
}

describe("driverFindings", () => {
  it("gives a model finding, a finding per leading driver and one for the questions that add little", () => {
    const f = driverFindings(report(), "an1");
    expect(f[0].stats.kind).toBe("driver_model");
    expect(f.filter((x) => x.stats.kind === "driver")).toHaveLength(3);
    expect(f[f.length - 1].stats.kind).toBe("driver_low");
    expect(f[f.length - 1].text).toContain("Branch cleanliness");
    expect(f.every((x) => !/—/.test(x.text))).toBe(true);
  });

  it("marks unstable ranks and heavy overlap as cautions and words them as association", () => {
    const f = driverFindings(report(), "an1");
    const staff = f.find((x) => x.stats.question === "Staff helpfulness")!;
    expect(staff.stats.caveats).toEqual(expect.arrayContaining(["unstable_rank", "high_overlap"]));
    expect(staff.text).toMatch(/not stable/);
    expect(f[0].text).toMatch(/does not show cause/);
  });

  it("flags a weak fit on every finding", () => {
    const f = driverFindings(report({ rSquared: 0.04 }), "an1");
    expect(f.every((x) => (x.stats.caveats as string[]).includes("weak_fit"))).toBe(true);
  });

  it("reads as a modelled basis and a weak fit is not supported", () => {
    const f = driverFindings(report({ rSquared: 0.04 }), "an1")[1];
    const stats = f.stats as Record<string, unknown>;
    expect(findingBasis({ origin: "generated", pattern_type: "driver", stated_stats: stats })).toBe("modelled");
    expect(codeVerdict("modelled", [], stats.caveats as string[]).tier).toBe("not_supported");
    expect(codeVerdict("modelled", [], []).tier).toBe("robust");
    expect(codeVerdict("modelled", [], ["unstable_rank"]).tier).toBe("use_with_caution");
  });
});
