// Permanent regression tests for the overnight queue's package 4 (IMP-004) fix:
// summarizeSeries() previously derived each bar's numeric code only from leadingNumber(b.label)
// - parsing the bar's DISPLAY LABEL text - so a text-labelled scale whose labels carry no leading
// digit always returned { value: null, base: series.n }, even when the chart's own data already
// carried the real underlying code in ChartSeries.bars[].rawCode (chartActions.ts). These tests
// exercise the actual summarizeSeries entry point, not a reimplementation of its logic.
import { describe, expect, it } from "vitest";
import { summarizeSeries } from "../csmMetrics";
import type { ChartSeries } from "../chartActions";

function series(bars: ChartSeries["bars"], n = 100): ChartSeries {
  return { name: "All respondents", n, bars };
}

describe("summarizeSeries (overnight queue, package 4, IMP-004)", () => {
  it("the user's named fixture: a five-point text-labelled scale with raw codes 1-5 and equal shares scores 40% top-two-box, not null", () => {
    const s = series([
      { label: "Very dissatisfied", pct: 20, rawCode: "1" },
      { label: "Dissatisfied", pct: 20, rawCode: "2" },
      { label: "Neutral", pct: 20, rawCode: "3" },
      { label: "Satisfied", pct: 20, rawCode: "4" },
      { label: "Very satisfied", pct: 20, rawCode: "5" },
    ]);
    // Before the fix: leadingNumber() finds no leading digit in any of these labels, so `coded`
    // was empty and this returned { value: null, base: 100 }.
    const result = summarizeSeries(s, "top2");
    expect(result.value).toBe(40);
    expect(result.base).toBe(100);
  });

  it("mean metric also uses rawCode on a text-labelled scale", () => {
    const s = series([
      { label: "Very dissatisfied", pct: 20, rawCode: "1" },
      { label: "Dissatisfied", pct: 20, rawCode: "2" },
      { label: "Neutral", pct: 20, rawCode: "3" },
      { label: "Satisfied", pct: 20, rawCode: "4" },
      { label: "Very satisfied", pct: 20, rawCode: "5" },
    ]);
    const result = summarizeSeries(s, "mean");
    expect(result.value).toBe(3);
  });

  it("top1 and top3 also use rawCode on a text-labelled scale", () => {
    const s = series([
      { label: "Very dissatisfied", pct: 10, rawCode: "1" },
      { label: "Dissatisfied", pct: 15, rawCode: "2" },
      { label: "Neutral", pct: 25, rawCode: "3" },
      { label: "Satisfied", pct: 30, rawCode: "4" },
      { label: "Very satisfied", pct: 20, rawCode: "5" },
    ]);
    expect(summarizeSeries(s, "top1").value).toBe(20);
    expect(summarizeSeries(s, "top3").value).toBe(75); // 30 + 20 + 25
  });

  it("regression: a numerically-labelled scale with no rawCode still scores via leadingNumber(label) exactly as before", () => {
    const s = series([
      { label: "1 - Not at all likely", pct: 20 },
      { label: "2", pct: 20 },
      { label: "3", pct: 20 },
      { label: "4", pct: 20 },
      { label: "5 - Extremely likely", pct: 20 },
    ]);
    const result = summarizeSeries(s, "top2");
    expect(result.value).toBe(40);
  });

  it("a present but non-numeric or blank rawCode falls back to leadingNumber(label), not to null", () => {
    const s = series([
      { label: "1 - Low", pct: 50, rawCode: "" },
      { label: "5 - High", pct: 50, rawCode: "n/a" },
    ]);
    const result = summarizeSeries(s, "top1");
    expect(result.value).toBe(50);
  });

  it("a bar with neither rawCode nor a leading-digit label is still dropped, not counted as zero", () => {
    const s = series([
      { label: "Very dissatisfied", pct: 20, rawCode: "1" },
      { label: "Very satisfied", pct: 20, rawCode: "5" },
      { label: "Don't know / Other", pct: 60 },
    ]);
    const result = summarizeSeries(s, "mean");
    // Only the two coded bars count: (1*20 + 5*20) / 40 = 3
    expect(result.value).toBe(3);
    expect(result.base).toBe(100); // base stays the series' real n, unaffected by the drop
  });

  it("all bars uncoded (no rawCode, no leading digit anywhere) returns null, not a crash", () => {
    const s = series([
      { label: "Agree", pct: 50 },
      { label: "Disagree", pct: 50 },
    ]);
    const result = summarizeSeries(s, "top2");
    expect(result.value).toBeNull();
    expect(result.base).toBe(100);
  });
});
