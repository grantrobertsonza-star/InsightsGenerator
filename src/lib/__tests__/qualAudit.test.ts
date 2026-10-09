import { describe, expect, it } from "vitest";
import {
  attentionCheck,
  auditSampleSize,
  codeStability,
  compareRuns,
  confidenceOf,
  estimateAudit,
  extendedAgreement,
  selectAuditSample,
  summariseStability,
} from "../qualAudit";
import { cohenKappa } from "../qualAnalysis";

const seg = (i: number, codes: number[], role: "participant" | "moderator" = "participant") => ({
  id: `s${i}`,
  index: i,
  role,
  codes,
});

describe("auditSampleSize", () => {
  it("floors at 30, caps at 120 and never exceeds the turns", () => {
    expect(auditSampleSize(0)).toBe(0);
    expect(auditSampleSize(10)).toBe(10);
    expect(auditSampleSize(100)).toBe(30);
    expect(auditSampleSize(400)).toBe(60);
    expect(auditSampleSize(5000)).toBe(120);
  });
});

describe("selectAuditSample", () => {
  const segs = [
    ...Array.from({ length: 120 }, (_, i) => seg(i, [1])),
    ...Array.from({ length: 40 }, (_, i) => seg(200 + i, [2])),
    ...Array.from({ length: 6 }, (_, i) => seg(300 + i, [3])),
    ...Array.from({ length: 34 }, (_, i) => seg(400 + i, [])),
    seg(900, [1], "moderator"),
  ];
  it("returns the requested size, no moderator turns, no duplicates", () => {
    const pick = selectAuditSample(segs, { size: 40 });
    expect(pick).toHaveLength(40);
    expect(new Set(pick.map((p) => p.id)).size).toBe(40);
    expect(pick.some((p) => p.id === "s900")).toBe(false);
  });
  it("covers every stratum, including rare codes and uncoded turns", () => {
    const pick = selectAuditSample(segs, { size: 40 });
    const strata = new Set(pick.map((p) => p.stratum));
    expect(strata).toEqual(new Set(["code-1", "code-2", "code-3", "none"]));
    expect(pick.filter((p) => p.stratum === "code-3").length).toBeGreaterThanOrEqual(2);
  });
  it("is proportional-ish and reports stratum sizes", () => {
    const pick = selectAuditSample(segs, { size: 40 });
    const one = pick.filter((p) => p.stratum === "code-1");
    expect(one[0].stratumSize).toBe(120);
    expect(one.length).toBeGreaterThan(pick.filter((p) => p.stratum === "code-2").length);
  });
  it("assigns a multi-code turn to its rarest code", () => {
    const pick = selectAuditSample(
      [...Array.from({ length: 10 }, (_, i) => seg(i, [1])), seg(50, [1, 2])],
      { size: 11 },
    );
    expect(pick.find((p) => p.id === "s50")!.stratum).toBe("code-2");
  });
  it("is repeatable and changes with the seed", () => {
    const a = selectAuditSample(segs, { size: 40, seed: "x" }).map((p) => p.id);
    const b = selectAuditSample(segs, { size: 40, seed: "x" }).map((p) => p.id);
    const c = selectAuditSample(segs, { size: 40, seed: "y" }).map((p) => p.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it("takes everything when the size exceeds the turns", () => {
    expect(selectAuditSample(segs.slice(0, 5), { size: 99 })).toHaveLength(5);
  });
});

describe("estimateAudit", () => {
  it("weights strata by size", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ stratum: "a", stratumSize: 90, match: true })),
      ...Array.from({ length: 10 }, () => ({ stratum: "b", stratumSize: 10, match: false })),
    ];
    const e = estimateAudit(rows)!;
    expect(e.accuracy).toBeCloseTo(0.9);
    expect(e.low).toBeLessThan(0.9);
    expect(e.high).toBeGreaterThan(0.9);
    expect(e.high).toBeLessThanOrEqual(1);
  });
  it("gives a wide interval on a small sample", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ stratum: "a", stratumSize: 100, match: i < 4 }));
    expect(estimateAudit(rows)!.wide).toBe(true);
  });
  it("counts drawn strata with no judged turn", () => {
    const rows = [{ stratum: "a", stratumSize: 5, match: true }];
    expect(estimateAudit(rows, ["a", "b"])!.missingStrata).toBe(1);
  });
  it("is null with nothing judged", () => {
    expect(estimateAudit([])).toBeNull();
  });
});

describe("extendedAgreement", () => {
  const mk = (spec: [boolean, boolean, number][]) =>
    cohenKappa(spec.flatMap(([model, researcher, n]) => Array.from({ length: n }, () => ({ model, researcher }))));
  it("matches a worked example", () => {
    const e = extendedAgreement(mk([[true, true, 20], [true, false, 5], [false, true, 10], [false, false, 15]]));
    expect(e.positiveAgreement).toBeCloseTo(40 / 55);
    expect(e.negativeAgreement).toBeCloseTo(30 / 45);
    expect(e.prevalence).toBeCloseTo(35 / 50);
    expect(e.pabak).toBeCloseTo(0.4);
    expect(e.bias).toBeCloseTo(-0.1);
    expect(e.skewed).toBe(false);
  });
  it("flags a rare code where kappa misleads", () => {
    const c = mk([[true, true, 2], [true, false, 1], [false, true, 1], [false, false, 96]]);
    const e = extendedAgreement(c);
    expect(e.skewed).toBe(true);
    expect(e.pabak).toBeCloseTo(0.96);
    expect(e.positiveAgreement).toBeCloseTo(0.667, 2);
  });
  it("handles empty input", () => {
    expect(extendedAgreement(cohenKappa([])).pabak).toBeNull();
  });
});

describe("stability", () => {
  const orig = new Map([[1, [1]], [2, [2]], [3, [1, 2]]]);
  const r1 = new Map([[1, [1]], [2, [3]], [3, [1]]]);
  const r2 = new Map([[1, [1]], [2, [2]], [3, [1, 2]], [4, [1]]]);
  it("scores each turn against the original", () => {
    const s = compareRuns(orig, [r1, r2], [1, 2, 3, 4]);
    expect(s[0]).toMatchObject({ agree: 3, runs: 3, confidence: "high" });
    expect(s[1]).toMatchObject({ agree: 2, altCodes: [3], droppedCodes: [2], confidence: "medium" });
    expect(s[2]).toMatchObject({ agree: 2, droppedCodes: [2], confidence: "medium" });
    expect(s[3]).toMatchObject({ agree: 2, altCodes: [1], confidence: "medium" });
  });
  it("sets confidence bands", () => {
    expect(confidenceOf(2, 2)).toBe("high");
    expect(confidenceOf(1, 2)).toBe("low");
    expect(confidenceOf(2, 3)).toBe("medium");
    expect(confidenceOf(1, 3)).toBe("low");
    expect(confidenceOf(1, 1)).toBe("high");
  });
  it("summarises", () => {
    const s = summariseStability([{ agree: 3, runs: 3 }, { agree: 2, runs: 3 }, { agree: 1, runs: 3 }]);
    expect(s).toMatchObject({ turns: 3, stable: 1, medium: 1, low: 1 });
    expect(s.share).toBeCloseTo(1 / 3);
    expect(summariseStability([]).share).toBeNull();
  });
  it("reports per-code consistency", () => {
    const c = codeStability(orig, [r1, r2], [1, 2, 3, 4], 3);
    expect(c[0]).toEqual({ code: 1, usedTurns: 3, consistent: 2 });
    expect(c[2]).toEqual({ code: 3, usedTurns: 1, consistent: 0 });
  });
});

describe("attentionCheck", () => {
  const at = (n: number, gapSec: number, changed: boolean) =>
    Array.from({ length: n }, (_, i) => ({ at: i * gapSec * 1000, changed }));
  it("is null with no decisions", () => {
    expect(attentionCheck([])).toBeNull();
  });
  it("says nothing on few decisions", () => {
    const a = attentionCheck(at(5, 3, false))!;
    expect(a.flagged).toBe(false);
    expect(a.reasons).toHaveLength(0);
  });
  it("flags fast, unchanged decisions", () => {
    const a = attentionCheck(at(10, 4, false))!;
    expect(a.flagged).toBe(true);
    expect(a.medianSeconds).toBeCloseTo(4);
  });
  it("does not flag a careful reviewer who changes things", () => {
    const ev = at(10, 40, false).map((e, i) => ({ ...e, changed: i % 3 === 0 }));
    expect(attentionCheck(ev)!.flagged).toBe(false);
  });
  it("ignores long breaks between sittings", () => {
    const ev = [
      ...at(5, 5, false),
      ...at(5, 5, false).map((e) => ({ ...e, at: e.at + 3 * 3600 * 1000 })),
    ];
    expect(attentionCheck(ev)!.medianSeconds).toBeCloseTo(5);
  });
});
