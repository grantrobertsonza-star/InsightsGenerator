import { describe, expect, it } from "vitest";
import { combineStances, matchLabel, parseExpectation, readComparison, readLevel } from "../evidenceStance";
import type { CrosstabResult } from "../parseStatsFile";

const base = (n: number) => ({ n, w: n, nEff: n });
function row(label: string, pct: number[], total: number, ns: number[], se?: number[], extra: Record<string, unknown> = {}) {
  return {
    label,
    count: pct.map(() => null),
    pct,
    rowPct: pct.map(() => null),
    p: pct.map(() => null),
    sig: pct.map(() => 0),
    se,
    base: ns.map(base),
    total: { count: null, pct: total, base: base(ns.reduce((a, b) => a + b, 0)) },
    ...extra,
  };
}
function table(rows: ReturnType<typeof row>[], cols = ["Women", "Men"]): CrosstabResult {
  return {
    version: 2,
    weightVar: null,
    weightLabel: null,
    blocks: [{ var: "g", label: "Gender" }],
    columns: cols.map((name) => ({ block: 0, blockLabel: "Gender", name, n: 200, w: 200, nEff: 200 })),
    total: base(400),
    questions: [{ key: "q", label: "Uses mobile banking", kind: "single", rows }],
  } as unknown as CrosstabResult;
}

describe("matchLabel", () => {
  it("prefers exact, then a single loose match, never an ambiguous one", () => {
    expect(matchLabel(["Yes", "No"], "yes")).toBe("Yes");
    expect(matchLabel(["Uses it daily", "Never"], "daily")).toBe("Uses it daily");
    expect(matchLabel(["Yes, sometimes", "Yes, often"], "yes")).toBeNull();
    expect(matchLabel(["Yes"], "")).toBeNull();
  });
});

describe("readLevel", () => {
  const t = table([row("Yes", [60, 50], 55, [200, 200])]);
  it("supports when the whole interval is above the threshold", () => {
    const r = readLevel(t, { kind: "level", answer: "Yes", direction: "above", threshold: 45 })!;
    expect(r.stance).toBe("supports");
    expect(r.estimate.value).toBe(55);
  });
  it("is against when the whole interval is on the wrong side", () => {
    expect(readLevel(t, { kind: "level", answer: "Yes", direction: "below", threshold: 45 })!.stance).toBe("against");
  });
  it("is inconclusive when the interval spans the threshold", () => {
    expect(readLevel(t, { kind: "level", answer: "Yes", direction: "above", threshold: 52 })!.stance).toBe("inconclusive");
  });
  it("is silent on a thin base and inconclusive (not null) for a missing answer", () => {
    // OBJ-REV-006: readLevel stopped returning null for a structurally-unbound expectation
    // (see evidenceStance.ts's own `unresolved` helper) - a missing row is now an explicit,
    // already-"computed" inconclusive Reading, so evaluateEvidenceQuestion's `if (computed)`
    // branch takes the computed path instead of falling through to a free-text model
    // judgment of some unrelated row in the table.
    const thin = table([row("Yes", [60, 50], 55, [10, 10])]);
    expect(readLevel(thin, { kind: "level", answer: "Yes", direction: "above", threshold: 10 })!.stance).toBe("silent");
    const missing = readLevel(t, { kind: "level", answer: "Maybe", direction: "above", threshold: 10 });
    expect(missing).not.toBeNull();
    expect(missing!.stance).toBe("inconclusive");
  });
});

describe("readComparison", () => {
  it("supports an expected gap when the interval excludes zero", () => {
    const t = table([row("Yes", [70, 50], 60, [200, 200])]);
    const r = readComparison(t, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "Women", groupB: "Men" })!;
    expect(r.stance).toBe("supports");
    expect(r.estimate.diff).toBe(20);
  });
  it("is against when the gap runs the other way", () => {
    const t = table([row("Yes", [50, 70], 60, [200, 200])]);
    expect(readComparison(t, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "Women", groupB: "Men" })!.stance).toBe("against");
  });
  it("is inconclusive for a small gap with no margin, against when inside a preset margin", () => {
    const t = table([row("Yes", [51, 50], 50.5, [200, 200])]);
    const e = { kind: "comparison" as const, answer: "Yes", direction: "higher" as const, groupA: "Women", groupB: "Men" };
    expect(readComparison(t, e)!.stance).toBe("inconclusive");
    const wide = table([row("Yes", [51, 50], 50.5, [2000, 2000])]);
    expect(readComparison(wide, { ...e, margin: 5 })!.stance).toBe("against");
  });
  it("uses the engine's standard errors when given", () => {
    const t = table([row("Yes", [60, 50], 55, [200, 200], [8, 8])]);
    expect(readComparison(t, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "Women", groupB: "Men" })!.stance).toBe("inconclusive");
  });
  it("is inconclusive (not null) when a group cannot be found, and silent on a thin group", () => {
    // Same OBJ-REV-006 contract change as readLevel above: an unresolvable group binding is
    // an explicit inconclusive Reading, not null.
    const t = table([row("Yes", [70, 50], 60, [200, 200])]);
    const missingGroup = readComparison(t, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "Rural", groupB: "Men" });
    expect(missingGroup).not.toBeNull();
    expect(missingGroup!.stance).toBe("inconclusive");
    const thin = table([row("Yes", [70, 50], 60, [200, 12])]);
    expect(readComparison(thin, { kind: "comparison", answer: "Yes", direction: "higher", groupA: "Women", groupB: "Men" })!.stance).toBe("silent");
  });
});

describe("mean rows", () => {
  it("reads a mean against a threshold using the descriptive sem", () => {
    const t = table([row("Mean satisfaction", [7, 6], 6.5, [200, 200], undefined, { isMean: true, desc: { n: 400, nEff: 400, mean: 6.5, sem: 0.1 } })]);
    const r = readLevel(t, { kind: "level", answer: null, direction: "above", threshold: 6 })!;
    expect(r.stance).toBe("supports");
    expect(r.estimate.measure).toBe("mean");
  });
});

describe("combineStances and parseExpectation", () => {
  it("combines sensibly", () => {
    expect(combineStances([])).toBe("silent");
    expect(combineStances(["supports", "inconclusive"])).toBe("supports");
    expect(combineStances(["supports", "against"])).toBe("mixed");
    expect(combineStances(["against", "silent"])).toBe("against");
    expect(combineStances(["inconclusive", "silent"])).toBe("inconclusive");
  });
  it("rejects incomplete expectations", () => {
    expect(parseExpectation({ kind: "level", direction: "above" })).toBeNull();
    expect(parseExpectation({ kind: "comparison", direction: "higher", groupA: "A" })).toBeNull();
    expect(parseExpectation({ kind: "level", direction: "above", threshold: 40, answer: "Yes" })).toMatchObject({ kind: "level", threshold: 40 });
    expect(parseExpectation(null)).toBeNull();
  });
});
