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
//   Combined (Codex B5-F01): margin 5, population 1,000, design effect 2: n0 = 2 * 384.146 = 768.29;
//     768.29 * 1000 / (1000 + 767.29) = 434.73 -> 435 (the smallest n whose margin is at most 5);
//     population 100, design effect 2: 768.29 * 100 / 867.29 = 88.59 -> 89, within the population.
// The forward/reverse agreement is checked against an independent oracle below: it enumerates whole
// samples against the margin formula written out in the test, not by calling the calculator.
import { describe, expect, it } from "vitest";
import { marginForSample, sampleSizeForMargin } from "../sampleSize";

const Z = { 90: 1.6448536269514722, 95: 1.959963984540054, 99: 2.5758293035489004 } as const;
/** The margin of a share, written out independently: z * sqrt(deff * p(1-p) / n) * sqrt((N-n)/(N-1)). */
function oracleMargin(n: number, conf: 90 | 95 | 99, p: number, deff: number, N: number | null) {
  const e = Z[conf] * Math.sqrt((deff * p * (1 - p)) / n);
  return N === null ? e : e * Math.sqrt((N - n) / (N - 1));
}
/** The smallest whole sample whose margin is at most e, by enumeration. */
function oracleSize(e: number, conf: 90 | 95 | 99, p: number, deff: number, N: number | null) {
  for (let n = 2; n <= (N ?? 1_000_000); n++) if (oracleMargin(n, conf, p, deff, N) <= e + 1e-12) return n;
  return null;
}

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
  it("with a population and a design effect together, gives the smallest sample the margin formula accepts, never more than the population (B5-F01)", () => {
    expect(sampleSizeForMargin({ marginPct: 5, population: 1000, designEffect: 2 }).completes).toBe(435);
    const small = sampleSizeForMargin({ marginPct: 5, population: 100, designEffect: 2 });
    expect(small.completes).toBe(89);
    expect(marginForSample({ sampleSize: small.completes, population: 100, designEffect: 2 }).marginPct).toBeLessThanOrEqual(5);
    expect(small.steps[0]).toContain("design effect 2");
    for (const conf of [90, 95, 99] as const)
      for (const m of [2, 3, 5, 8])
        for (const deff of [1, 1.5, 2, 3])
          for (const N of [null, 50, 100, 1000, 5000, 100000])
            for (const share of [50, 20]) {
              const got = sampleSizeForMargin({ marginPct: m, confidencePct: conf, designEffect: deff, population: N, expectedSharePct: share }).completes;
              const want = oracleSize(m / 100, conf, share / 100, deff, N);
              expect({ conf, m, deff, N, share, n: got }).toEqual({ conf, m, deff, N, share, n: want });
            }
  });
  it("refuses a response rate that would need more people than the population, and recovers when it is feasible", () => {
    expect(() => sampleSizeForMargin({ marginPct: 5, population: 100, designEffect: 2, responseRatePct: 50 })).toThrow(/more than the population of 100/);
    expect(sampleSizeForMargin({ marginPct: 5, population: 1000, designEffect: 2, responseRatePct: 50 }).approach).toBe(870);
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

// Codex RR-F04 (2026-10-23): at 95%, an expected share of 1% and a 49-point margin the formula gives
// ceil(1.959964^2 * 0.01 * 0.99 / 0.49^2) = ceil(0.158) = 1, which the reverse direction refused (it
// needs two interviews for a margin). Both directions now share a minimum of two.
describe("RR-F04: the smallest samples are accepted in both directions", () => {
  it("raises a result below two to two, says so, and the margin of two still meets the target", () => {
    const r = sampleSizeForMargin({ marginPct: 49, expectedSharePct: 1 });
    expect(r.completes).toBe(2);
    expect(r.steps.join(" ")).toMatch(/Rounded up: 1 completed interview .*Raised to 2/);
    const back = marginForSample({ sampleSize: r.completes, expectedSharePct: 1 });
    expect(back.marginPct).toBeLessThanOrEqual(49);
    expect(back.marginPct).toBeCloseTo(oracleMargin(2, 95, 0.01, 1, null) * 100, 1);
  });

  it("every forward result over a small-share, wide-margin grid is accepted by the reverse and is the oracle's smallest sample", () => {
    for (const conf of [90, 95, 99] as const)
      for (const share of [0.5, 1, 2, 5])
        for (const margin of [20, 30, 40, 49])
          for (const deff of [1, 1.5])
            for (const population of [null, 2, 3, 50]) {
              const input = { marginPct: margin, confidencePct: conf, expectedSharePct: share, designEffect: deff, population };
              const r = sampleSizeForMargin(input);
              const back = marginForSample({ sampleSize: r.completes, confidencePct: conf, expectedSharePct: share, designEffect: deff, population });
              expect(back.marginPct).toBeLessThanOrEqual(margin + 0.005);
              expect(r.completes).toBe(oracleSize(margin / 100, conf, share / 100, deff, population));
            }
  });

  it("still refuses a sample of one in the reverse direction, with the shared minimum in the message", () => {
    expect(() => marginForSample({ sampleSize: 1 })).toThrow("at least 2");
  });
});
