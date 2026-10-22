// Sample size and margin of error (sampleSize.ts), against hand-computed references (Cochran, 1977):
//   95% confidence (z = 1.959964), p = 0.5:
//     margin 5:  n0 = 1.959964^2 * 0.25 / 0.0025 = 384.146 -> 385
//     margin 3:  n0 = 1067.07 -> 1068
//     margin 5, population 1,000: 384.146 / (1 + 383.146 / 1000) = 277.74 -> 278
//     margin 5, design effect 1.5: 576.22 -> 577; at a 20% response rate, 385 / 0.2 = 1925 to approach
//   99% confidence, margin 5: 2.575829^2 * 0.25 / 0.0025 = 663.49 -> 664
//   p = 0.2, margin 5: 3.841459 * 0.16 / 0.0025 = 245.85 -> 246
//   margin of n = 1,000 at 95%: 1.959964 * sqrt(0.25 / 1000) = 3.099 points -> 3.1
//   n = 400: 4.90 points; n = 500 of a population of 2,000: 4.383 * sqrt(1500 / 1999) = 3.797 -> 3.8
import { describe, expect, it } from "vitest";
import { marginForSample, sampleSizeForMargin } from "../sampleSize";

describe("sampleSizeForMargin", () => {
  it("matches the hand-computed references", () => {
    expect(sampleSizeForMargin({ marginPct: 5 }).completes).toBe(385);
    expect(sampleSizeForMargin({ marginPct: 3 }).completes).toBe(1068);
    expect(sampleSizeForMargin({ marginPct: 5, population: 1000 }).completes).toBe(278);
    const deff = sampleSizeForMargin({ marginPct: 5, designEffect: 1.5, responseRatePct: 20 });
    expect(deff.completes).toBe(577);
    expect(deff.simpleRandom).toBe(385);
    expect(deff.approach).toBe(Math.ceil(577 / 0.2));
    expect(sampleSizeForMargin({ marginPct: 5, confidencePct: 99 }).completes).toBe(664);
    expect(sampleSizeForMargin({ marginPct: 5, expectedSharePct: 20 }).completes).toBe(246);
  });
  it("shows its working and assumptions, including the subgroup caution", () => {
    const r = sampleSizeForMargin({ marginPct: 5 });
    expect(r.steps[0]).toContain("384.1");
    expect(r.assumptions.join(" ")).toMatch(/most conservative/);
    expect(r.assumptions.join(" ")).toMatch(/each subgroup reported separately needs its own size/);
  });
  it("refuses inputs it cannot use, rather than guessing", () => {
    expect(() => sampleSizeForMargin({ marginPct: 0 })).toThrow(/margin/);
    expect(() => sampleSizeForMargin({ marginPct: 5, confidencePct: 80 })).toThrow(/90, 95 or 99/);
    expect(() => sampleSizeForMargin({ marginPct: 5, expectedSharePct: 100 })).toThrow(/expected share/);
    expect(() => sampleSizeForMargin({ marginPct: 5, designEffect: 0.5 })).toThrow(/design effect/);
    expect(() => sampleSizeForMargin({ marginPct: 5, population: 1.5 })).toThrow(/population/);
    expect(() => sampleSizeForMargin({ marginPct: 5, responseRatePct: 0 })).toThrow(/response rate/);
  });
});

describe("marginForSample", () => {
  it("matches the hand-computed references", () => {
    expect(marginForSample({ sampleSize: 1000 }).marginPct).toBe(3.1);
    expect(marginForSample({ sampleSize: 400 }).marginPct).toBe(4.9);
    expect(marginForSample({ sampleSize: 500, population: 2000 }).marginPct).toBe(3.8);
  });
  it("is the inverse of the sample size: the size for a margin gives at most that margin", () => {
    for (const m of [2, 3, 4, 5, 7.5]) expect(marginForSample({ sampleSize: sampleSizeForMargin({ marginPct: m }).completes }).marginPct).toBeLessThanOrEqual(m);
  });
  it("refuses a sample larger than the population", () => {
    expect(() => marginForSample({ sampleSize: 3000, population: 2000 })).toThrow(/larger than the population/);
  });
});
