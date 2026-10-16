// OBJ-REV-005: objective-evidence readings against INDEPENDENT reference values. Each expected
// interval below is worked by hand from the stated formula, not taken from the code:
//   share:      se = sqrt(p(1-p)/n_eff) * 100;  95% interval = p +/- 1.96 se (clipped to 0..100)
//   mean:       se = the engine's standard error of the mean; interval = mean +/- 1.96 se
//   difference: se = sqrt(seA^2 + seB^2) (independent groups); interval = diff +/- 1.96 se
// Contracts checked: means are never judged against a share threshold (and vice versa) when the
// expectation declares its measure; the EFFECTIVE base (not the raw count) sets both the minimum-
// base rule and the interval; rescaling weights changes nothing; a declared margin takes precedence.
import { describe, expect, it } from "vitest";
import { parseExpectation, readComparison, readLevel } from "../evidenceStance";
import type { CrosstabResult } from "../parseStatsFile";

type Base = { n: number; w: number; nEff: number };
const b = (n: number, w = n, nEff = n): Base => ({ n, w, nEff });

function result(rows: Record<string, unknown>[], columns: { name: string; base: Base }[], overall = false): CrosstabResult {
  return {
    version: 2,
    weightVar: null,
    weightLabel: null,
    overall,
    blocks: [{ var: "g", label: "Group" }],
    columns: columns.map((c) => ({ block: 0, blockLabel: "Group", name: c.name, n: c.base.n, w: c.base.w, nEff: c.base.nEff })),
    total: columns.reduce((acc, c) => b(acc.n + c.base.n, acc.w + c.base.w, acc.nEff + c.base.nEff), b(0)),
    questions: [{ key: "q", label: "Q", kind: "single", rows }],
  } as unknown as CrosstabResult;
}
const share = (label: string, pct: number[], total: number, bases: Base[], totalBase: Base) => ({
  label,
  count: pct.map(() => null),
  pct,
  rowPct: pct.map(() => null),
  p: pct.map(() => null),
  sig: pct.map(() => 0),
  base: bases,
  total: { count: null, pct: total, base: totalBase },
});

describe("levels (reference values)", () => {
  // p = 55%, n_eff = 400: se = sqrt(.55*.45/400)*100 = 2.4875; interval 50.124 to 59.876.
  const t = result([share("Yes", [55, 55], 55, [b(200), b(200)], b(400))], [{ name: "A", base: b(200) }, { name: "B", base: b(200) }]);

  it("share: interval matches the hand calculation and is judged against it exactly", () => {
    const r = readLevel(t, { kind: "level", answer: "Yes", direction: "above", threshold: 50, question: null })!;
    expect(r.estimate.lo).toBeCloseTo(50.1, 1);
    expect(r.estimate.hi).toBeCloseTo(59.9, 1);
    expect(r.stance).toBe("supports"); // 50.124 > 50
    expect(readLevel(t, { kind: "level", answer: "Yes", direction: "above", threshold: 50.2, question: null })!.stance).toBe("inconclusive");
  });

  it("the EFFECTIVE base sets the interval: same share, n 400 but n_eff 100 -> se 4.975, interval 45.25 to 64.75", () => {
    const w = result([share("Yes", [55, 55], 55, [b(200, 200, 50), b(200, 200, 50)], b(400, 400, 100))], [
      { name: "A", base: b(200, 200, 50) },
      { name: "B", base: b(200, 200, 50) },
    ]);
    const r = readLevel(w, { kind: "level", answer: "Yes", direction: "above", threshold: 50, question: null })!;
    expect(r.estimate.lo).toBeCloseTo(45.2, 1);
    expect(r.estimate.hi).toBeCloseTo(64.8, 1);
    expect(r.stance).toBe("inconclusive");
    expect(r.estimate.n).toBe(100);
  });

  it("an effective base under 30 is too thin to read, even when the raw count is large", () => {
    const thin = result([share("Yes", [90, 90], 90, [b(200, 200, 14), b(200, 200, 14)], b(400, 400, 28))], [
      { name: "A", base: b(200, 200, 14) },
      { name: "B", base: b(200, 200, 14) },
    ]);
    expect(readLevel(thin, { kind: "level", answer: "Yes", direction: "above", threshold: 50, question: null })!.stance).toBe("silent");
  });

  it("weight rescaling changes nothing (weighted totals x10, same effective base)", () => {
    const scaled = result([share("Yes", [55, 55], 55, [b(200, 2000, 200), b(200, 2000, 200)], b(400, 4000, 400))], [
      { name: "A", base: b(200, 2000, 200) },
      { name: "B", base: b(200, 2000, 200) },
    ]);
    const e = { kind: "level" as const, answer: "Yes", direction: "above" as const, threshold: 50, question: null };
    expect(readLevel(scaled, e)).toEqual(readLevel(t, e));
  });

  it("mean: uses the engine's standard error (3.5, se 0.06 -> 3.38 to 3.62)", () => {
    const m = result(
      [{ ...share("Mean", [3.5, 3.5], 3.5, [b(200), b(200)], b(400)), isMean: true, desc: { sem: 0.06 } }],
      [{ name: "A", base: b(200) }, { name: "B", base: b(200) }],
    );
    const r = readLevel(m, { kind: "level", answer: null, direction: "above", threshold: 3.3, question: null, measure: "mean" })!;
    expect(r.estimate.measure).toBe("mean");
    expect(r.estimate.lo).toBeCloseTo(3.4, 1);
    expect(r.stance).toBe("supports"); // 3.3824 > 3.3
    expect(readLevel(m, { kind: "level", answer: null, direction: "above", threshold: 3.4, question: null, measure: "mean" })!.stance).toBe("inconclusive");
  });

  it("a share threshold is never judged against a mean row (the reading is unresolved, not 'against')", () => {
    const m = result(
      [{ ...share("Mean", [3.5, 3.5], 3.5, [b(200), b(200)], b(400)), isMean: true, desc: { sem: 0.06 } }],
      [{ name: "A", base: b(200) }, { name: "B", base: b(200) }],
    );
    const r = readLevel(m, { kind: "level", answer: null, direction: "above", threshold: 50, question: null, measure: "percent" })!;
    expect(r.stance).toBe("inconclusive");
    expect(r.estimate.value).toBeNull();
    expect(r.summary).toMatch(/expectation is a share \(percent\) but this row is an average or score/);
    // Older expectations without a declared measure keep the earlier behaviour.
    expect(parseExpectation({ kind: "level", direction: "above", threshold: 50 })).toMatchObject({ measure: null });
  });
});

describe("comparisons (reference values)", () => {
  // A 60% (n 100), B 40% (n 100): seA = seB = 4.899; se diff = 6.928; gap 20, interval 6.42 to 33.58.
  const c = result([share("Yes", [60, 40], 50, [b(100), b(100)], b(200))], [{ name: "A", base: b(100) }, { name: "B", base: b(100) }]);

  it("gap and interval match the hand calculation; direction decides supports/against", () => {
    const r = readComparison(c, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "A", groupB: "B", question: null })!;
    expect(r.estimate.diff).toBe(20);
    expect(r.estimate.diffLo).toBeCloseTo(6.4, 1);
    expect(r.estimate.diffHi).toBeCloseTo(33.6, 1);
    expect(r.stance).toBe("supports");
    expect(readComparison(c, { kind: "comparison", answer: "Yes", direction: "lower", groupA: "A", groupB: "B", question: null })!.stance).toBe("against");
  });

  it("a margin that contains the whole interval reads 'no meaningful difference' (against), ahead of significance", () => {
    const r = readComparison(c, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "A", groupB: "B", margin: 40, question: null })!;
    expect(r.stance).toBe("against");
  });

  it("a group under the minimum effective base is silent", () => {
    const thin = result([share("Yes", [60, 40], 50, [b(100, 100, 20), b(100)], b(200))], [{ name: "A", base: b(100, 100, 20) }, { name: "B", base: b(100) }]);
    expect(readComparison(thin, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "A", groupB: "B", question: null })!.stance).toBe("silent");
  });

  it("a declared measure that does not match the row is unresolved", () => {
    const r = readComparison(c, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "A", groupB: "B", question: null, measure: "mean" })!;
    expect(r.stance).toBe("inconclusive");
    expect(r.summary).toMatch(/cannot be compared/);
  });
});
