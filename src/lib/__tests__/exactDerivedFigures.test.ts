// Batch 59, CT5K-F01 follow-up (coordinator, 28 October 2026): figures derived from several shares (NPS,
// top-box, a coded mean, a brand category average and funnel ratio) are added from the engine's unrounded
// figures (pctExact, carried into charts as `share`) and rounded once, never from the one-decimal display
// values. The tables below are written by hand so that rounding the parts first changes the answer:
//   NPS scale: points 0 to 6 at 4.54% each (detractors 31.78%), 7 at 16.00%, 8 at 15.94% (passives
//   31.94%), 9 and 10 at 18.14% each (promoters 36.28%). Exact NPS 36.28 - 31.78 = 4.50, shown 4.5; from
//   the display parts (4.5 x 7 = 31.5, 18.1 x 2 = 36.2) it would be 4.7.
//   Five-point scale: 5 and 4 at 20.04% each: top two 40.08%, shown 40.1; display parts 20.0 + 20.0 = 40.0.
// The parts here stand in for the engine's output; the engine itself and the saved, reloaded and exported
// tables are checked in weightScalePercentages.db.test.ts.
import { describe, expect, it } from "vitest";
import { computeNps, levelFindings } from "../descriptiveFindings";
import { summarizeSeries } from "../csmMetrics";
import { categoryAverage, categoryAverageExact } from "../brandHealthMetrics";
import type { CrosstabResult, CrosstabRow } from "../parseStatsFile";
import type { ChartSeries } from "../chartActions";

const base = { n: 1100, w: 100, nEff: 1100 };
function row(label: string, display: number, exact: number | undefined): CrosstabRow {
  return {
    label,
    count: [display],
    pct: [display],
    ...(exact === undefined ? {} : { pctExact: [exact], countExact: [exact] }),
    rowPct: [100],
    p: [null],
    sig: [0],
    base: [base],
    total: { count: display, pct: display, ...(exact === undefined ? {} : { pctExact: exact, countExact: exact }), base },
  };
}
const npsShares: [number, number][] = [
  ...Array.from({ length: 7 }, () => [4.5, 4.54] as [number, number]),
  [16.0, 16.0],
  [15.9, 15.94],
  [18.1, 18.14],
  [18.1, 18.14],
];
const npsRows = (withExact: boolean) => npsShares.map(([d, e], k) => row(String(k), d, withExact ? e : undefined));

describe("CT5K-F01: derived figures from unrounded shares", () => {
  it("NPS adds the unrounded shares: 4.5 (promoters 36.3, passives 31.9, detractors 31.8), not 4.7 from the display parts", () => {
    const nps = computeNps(npsRows(true), 1100)!;
    expect(nps).toMatchObject({ nps: 4.5, promoters: 36.3, passives: 31.9, detractors: 31.8, suppressed: false });
  });

  it("NPS of one banner column reads that column's unrounded shares through the same rule", async () => {
    const { exactPct } = await import("../crosstabExact");
    expect(computeNps(npsRows(true), 1100, (r) => exactPct(r, 0))!.nps).toBe(4.5);
  });

  it("a table saved before the exact figures were kept is read from its rounded shares (the earlier method, already marked)", () => {
    expect(computeNps(npsRows(false), 1100)!.nps).toBe(4.7);
  });

  it("a suppressed scale point still makes the NPS unavailable", () => {
    const rows = npsRows(true);
    rows[3] = { ...rows[3], pct: [null], pctExact: [null], total: { ...rows[3].total, pct: null, pctExact: null } };
    expect(computeNps(rows, 1100)!.suppressed).toBe(true);
  });

  const series = (shares: (number | null | undefined)[], display: number[]): ChartSeries => ({
    name: "All",
    n: 500,
    bars: display.map((pct, i) => ({ label: String(i + 1), pct, ...(shares[i] === undefined ? {} : { share: shares[i] }), rawCode: String(i + 1) })),
  });
  const fiveDisplay = [20.0, 20.0, 19.9, 20.0, 20.0];
  const fiveExact = [20.0, 20.0, 19.92, 20.04, 20.04];

  it("CSM top-two box adds the unrounded shares: 40.1 (exact 40.08), not 40.0", () => {
    const s = summarizeSeries(series(fiveExact, fiveDisplay), "top2");
    expect(s.value).toBe(40.1);
    expect(s.exact).toBeCloseTo(40.08, 10);
  });

  it("CSM coded mean uses the unrounded shares: (1x20 + 2x20 + 3x19.92 + 4x20.04 + 5x20.04) / 100 = 300.12 / 100 = 3.0012", () => {
    expect(summarizeSeries(series(fiveExact, fiveDisplay), "mean").exact).toBeCloseTo(3.0012, 10);
  });

  it("a suppressed bar makes the CSM reading unavailable, not 0; a series without shares reads its display values", () => {
    expect(summarizeSeries(series([null, null, null, null, null], [0, 0, 0, 0, 0]), "top2")).toMatchObject({ value: null, exact: null });
    expect(summarizeSeries(series([undefined, undefined, undefined, undefined, undefined], fiveDisplay), "top2").value).toBe(40.0);
  });

  it("brand category average is the mean of the unrounded scores, rounded once: 10.2 (exact 10.1733), not 10.1", () => {
    const byBrand = [
      { value: 10.1, exact: 10.14 },
      { value: 10.1, exact: 10.14 },
      { value: 10.2, exact: 10.24 },
    ];
    expect(categoryAverage(byBrand)).toBe(10.2);
    expect(categoryAverageExact(byBrand)).toBeCloseTo(30.52 / 3, 10);
    expect(categoryAverage(byBrand.map(({ value }) => ({ value })))).toBe(10.1);
  });

  it("the automatic top-two box finding adds the unrounded shares: 40.1%", () => {
    const rows = fiveExact.map((e, i) => row(String(i + 1), fiveDisplay[i], e));
    const result = {
      version: 2,
      weightVar: "w",
      weightLabel: "w",
      overall: true,
      blocks: [],
      columns: [{ block: 0, blockLabel: "All", name: "All respondents", n: 500, w: 100, nEff: 500 }],
      total: base,
      questions: [{ key: "r", label: "Rating", kind: "single", rows }],
      skipped: [],
    } as unknown as CrosstabResult;
    const top = levelFindings(result).find((f) => f.stats?.testType === "top_two_box");
    expect(top?.stats?.value).toBe(40.1);
    expect(top?.text).toMatch(/^Top two box on Rating \(taking the two highest codes, 4 and 5, as the top two\): 40\.1%/);
  });
});
