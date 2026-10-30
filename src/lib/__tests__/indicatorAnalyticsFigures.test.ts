// Indicator Analytics (D6): the pure rules of the single-indicator dashboard (src/lib/indicatorAnalyticsFigures.ts;
// contract claude/indicator-analytics.md). Expected values are written out by hand from the inputs shown.
import { describe, expect, it } from "vitest";
import {
  changeBetween,
  comparisonFor,
  definitionLines,
  figureText,
  fileReadiness,
  headlineFigures,
  observedTrend,
  periodPosition,
  providerLines,
  seriesAttributesOf,
  seriesKeyFor,
  seriesNeedsReview,
  shownDecimals,
  suggestedArea,
  timeAxisOf,
  axisFraction,
  suggestedTrendAreas,
  viewSummary,
  withheldPeriods,
  breakdownFilterName,
} from "../indicatorAnalyticsFigures";
import type { IndicatorFileSummary, IndicatorObservation, IndicatorSeriesSummary } from "../indicatorData";

const pct: IndicatorSeriesSummary = {
  id: "s1", key: "K02", indicatorCode: "RH_ANCC_W_IRN", indicatorLabel: "Iron during antenatal care",
  breakdowns: [{ dimension: "COMP_BREAKDOWN_1", code: "ANCC_IRN_02", label: "Timelapse: Two years preceding the survey" }],
  unitCode: "PT_W_SUB", unitLabel: "Percentage of women in the same subgroup", unitMult: 0, valueScale: null, baseDescription: null, groups: null,
  observationCount: 6, areaCodes: ["KEN", "GHA", "EST"], withheldOnlyAreaCodes: [],
};
const o = (areaCode: string | null, period: string | null, valueText: string, note: string | null = null, status: string | null = "A"): IndicatorObservation => ({ areaCode, period, valueText, status, note });
const KEN = [o("KEN", "2003", "45.8", "DHS, 2003"), o("KEN", "2008", "71.0", "DHS, 2008-09"), o("KEN", "2014", "70.5", "DHS, 2014"), o("KEN", "2022", "90.2", "DHS, 2022")];
const statuses = { A: "Normal value", E: "Estimated value" };

describe("calendar and number formatting", () => {
  it("places years, quarters, halves and months at their first day on one day-numbered calendar", () => {
    const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86400000;
    expect([periodPosition("2008"), periodPosition("2023-Q2"), periodPosition("2023-S2"), periodPosition("2023-M04"), periodPosition("2023-04")]).toEqual([day(2008, 1, 1), day(2023, 4, 1), day(2023, 7, 1), day(2023, 4, 1), day(2023, 4, 1)]);
    expect([periodPosition("2023-13"), periodPosition("2023-M00"), periodPosition("2023-02-29"), periodPosition("23"), periodPosition("Not stated")]).toEqual([null, null, null, null, null]);
  });
  it("shows the recorded decimals, or the decimals as written, less the places a multiplier or proportion adds", () => {
    expect(shownDecimals("71.0", pct, null)).toBe(1);
    expect(shownDecimals("71", pct, 1)).toBe(1);
    expect(shownDecimals("3.427", { ...pct, unitMult: 6 }, 2)).toBe(0);
    expect(shownDecimals("0.811", { ...pct, valueScale: "proportion" }, null)).toBe(1);
    expect(shownDecimals("5.12E-4", pct, null)).toBeNull();
    expect(figureText(71, 1, pct)).toBe("71.0%");
    expect(figureText(3427000, 0, { ...pct, unitCode: "RC", unitLabel: "Reported currency" })).toBe("3,427,000");
  });
});

describe("headline, change and summary", () => {
  const trend = observedTrend(KEN, "KEN", pct, { from: null, to: null }, 1, statuses);
  it("latest and previous are the last two observations; change in percentage points, not year-on-year", () => {
    const h = headlineFigures(trend, pct);
    expect([h.latest?.shown, h.previous?.shown, h.observationCount]).toEqual(["90.2%", "70.5%", 4]);
    expect(h.change).toMatchObject({ text: "+19.7 pp", periodsText: "2022 vs 2014, not year-on-year", arithmetic: "90.2% minus 70.5%", unitWords: "percentage points" });
    expect(h.observed.map((x) => x.note)).toEqual(["DHS, 2003", "DHS, 2008-09", "DHS, 2014", "DHS, 2022"]);
  });
  it("a fall, no change at the shown precision, consecutive years, and a unit that is not a percentage", () => {
    const [a, b] = observedTrend([o("X", "2020", "70.54"), o("X", "2021", "70.5")], "X", pct, { from: null, to: null }, 1, statuses);
    // -0.04 rounds to 0.0 at one decimal: the change is a fall smaller than the shown precision, never "no change".
    expect(changeBetween(a, b, pct)).toMatchObject({ direction: "fell", text: "-<0.1 pp", periodsText: "2021 vs 2020, consecutive years" });
    const usd = { ...pct, unitCode: "USD", unitLabel: "US dollar", valueScale: null };
    const [c, d] = observedTrend([o("X", "2019", "10.25"), o("X", "2023", "9.75")], "X", usd, { from: null, to: null }, null, statuses);
    expect(changeBetween(c, d, usd)).toMatchObject({ text: "-0.50", unitWords: "in the series' unit (US dollar (USD))" });
    const h = headlineFigures([a, b], pct);
    expect(viewSummary("X", h, []).statement).toBe("For X, the reported value is shown as 70.5% in both 2020 and 2021; unrounded, it fell (change -<0.1 pp).");
    expect(viewSummary("X", h, []).detail).toBe("The two observations are from consecutive years. No annual path or statistical significance is inferred.");
  });
  it("the range limits the trend; a period the file does not state is left out; one observation states no change", () => {
    const t = observedTrend([...KEN, o("KEN", null, "50.0")], "KEN", pct, { from: "2004", to: "2014" }, 1, statuses);
    expect(t.map((p) => p.period)).toEqual(["2008", "2014"]);
    const one = headlineFigures(observedTrend(KEN, "KEN", pct, { from: "2015", to: null }, 1, statuses), pct);
    expect(one.change).toBeNull();
    expect(viewSummary("Kenya", one, ["2024"])).toEqual({ statement: "Kenya: 90.2% in 2022, the only observation in this range.", detail: "No change can be stated from one observation. 2024 is withheld by the publisher as confidential and not counted." });
    expect(viewSummary("Kenya", headlineFigures([], pct), [])).toEqual({ statement: "Kenya has no observed value in this range.", detail: "Nothing is filled in or carried forward from another period." });
  });
  it("an 11-year gap reads 'an 11-year gap'", () => {
    const h = headlineFigures(observedTrend([o("X", "2003", "1.0"), o("X", "2014", "2.0")], "X", pct, { from: null, to: null }, 1, statuses), pct);
    expect(viewSummary("X", h, []).detail).toMatch(/^This is an 11-year gap/);
  });
});

describe("comparison, withheld and suggestions", () => {
  const obs = [...KEN, o("GHA", "2022", "92.3", "DHS, 2022"), o("GHA", "2014", "91.4"), o("EST", "2014", "90.2")];
  const prov = { withheld: [["K02", "EST", "2022"], ["OTHER", "KEN", "2022"]] };
  it("one period only, highest first, withheld listed apart, areas lacking the period counted, never filled", () => {
    const c = comparisonFor(obs, "2022", pct, [{ code: "KEN", label: "Kenya" }, { code: "GHA", label: "Ghana" }, { code: "EST", label: "Estonia" }], prov, "KEN", 1, statuses);
    expect(c.rows.map((r) => [r.areaCode, r.shown, r.selected])).toEqual([["GHA", "92.3%", false], ["KEN", "90.2%", true]]);
    expect(c.withheld.map((w) => w.areaCode)).toEqual(["EST"]);
    expect(c.notObserved).toBe(1);
    // Equal values are ordered by area code.
    const tie = comparisonFor([o("ZZZ", "2014", "90.2"), o("EST", "2014", "90.2")], "2014", pct, [], {}, null, 1, statuses);
    expect(tie.rows.map((r) => r.areaCode)).toEqual(["EST", "ZZZ"]);
  });
  it("withheld periods are those of this series and area only", () => {
    expect(withheldPeriods(prov, pct, "EST", { from: null, to: null })).toEqual(["2022"]);
    expect(withheldPeriods(prov, pct, "KEN", { from: null, to: null })).toEqual([]);
  });
  it("suggested area: most observations, then latest, then code; trend panels: selected first, then the same period highest first", () => {
    expect(suggestedArea(obs)).toBe("KEN");
    expect(suggestedArea([o("B", "2001", "1"), o("A", "2001", "1")])).toBe("A");
    expect(suggestedArea([o("B", "2002", "1"), o("A", "2001", "1")])).toBe("B");
    expect(suggestedTrendAreas(obs, "KEN", "2022", pct)).toEqual(["KEN", "GHA"]);
  });
});

describe("series identity and review", () => {
  const choices = [
    { key: "K02", indicatorKey: "code:I", codes: { W: "02", SEX: "F" } },
    { key: "K03", indicatorKey: "code:I", codes: { W: "03", SEX: "F" } },
    { key: "J", indicatorKey: "code:J", codes: { W: "05", SEX: "F" } },
  ];
  it("a series by its codes; a pick the indicator lacks takes its first code; a missing combination is null", () => {
    expect(seriesKeyFor(choices, "code:I", { W: "03" })).toBe("K03");
    expect(seriesKeyFor(choices, "code:J", { W: "03" })).toBe("J");
    expect(seriesKeyFor([...choices, { key: "K02M", indicatorKey: "code:I", codes: { W: "02", SEX: "M" } }], "code:I", { W: "03", SEX: "M" })).toBeNull();
    expect(seriesKeyFor(choices, "code:none", {})).toBeNull();
  });
  it("names the reference window by its labels; two codes of a series-key attribute need review", () => {
    expect(breakdownFilterName({ dimension: "COMP_BREAKDOWN_1", values: [{ code: "ANCC_IRN_02", label: "Timelapse: Two years preceding the survey (ANCC_IRN_02)" }, { code: "ANCC_IRN_03", label: "Timelapse: Three years (ANCC_IRN_03)" }] })).toBe("Reference window");
    expect(breakdownFilterName({ dimension: "SEX", values: [{ code: "F", label: "Female (F)" }, { code: "M", label: "Male (M)" }] })).toBe("SEX");
    const two = seriesAttributesOf({ seriesAttributeColumns: ["AGG_METHOD"], seriesAttributes: { K02: { AGG_METHOD: [{ code: "WT", label: null }, { code: "_Z", label: "Not Applicable" }] } } }, "K02");
    expect(seriesNeedsReview(two)).toMatch(/^Needs review: AGG_METHOD has 2 codes in this series \(WT, _Z\)/);
    const decimalsVary = seriesAttributesOf({ seriesAttributeColumns: ["DECIMALS"], seriesAttributes: { K02: { DECIMALS: [{ code: "1", label: null }, { code: "2", label: null }] } } }, "K02");
    expect(seriesNeedsReview(decimalsVary)).toBeNull();
    expect(seriesNeedsReview(seriesAttributesOf({}, "K02"))).toBeNull();
  });
  it("definition lines say when an attribute was not recorded, not stated, or blank, never a default", () => {
    const base = { s: pct, provenance: { statuses: { A: "Normal value" } }, fileName: "f.csv", layout: "data360_wide" as const, publishedAt: "2026-10-29T10:00:00.000Z", observations: KEN };
    const line = (lines: { label: string; value: string }[], label: string) => lines.find((l) => l.label === label)!.value;
    expect(line(definitionLines({ ...base, attributes: { state: "not_recorded" } }), "Decimals")).toMatch(/^not recorded by this file's read/);
    expect(line(definitionLines({ ...base, attributes: { state: "recorded", columns: [], values: {} } }), "Decimals")).toBe("not stated in the file");
    expect(line(definitionLines({ ...base, attributes: { state: "recorded", columns: ["DECIMALS"], values: {} } }), "Decimals")).toBe("blank in the file for this series");
    const d = definitionLines({ ...base, attributes: { state: "recorded", columns: ["DECIMALS"], values: { DECIMALS: [{ code: "1", label: "One" }] } } });
    expect([line(d, "Decimals"), line(d, "Observation status"), line(d, "Source metadata date"), line(d, "Release vintage")]).toEqual(["One (1)", "Normal value (A)", "not supplied in the file", "not supplied in the file"]);
  });
});

describe("readiness per file and per provider", () => {
  const file = (name: string, read: Partial<NonNullable<IndicatorFileSummary["read"]>> | null): IndicatorFileSummary => ({
    documentId: name, fileName: name, processingStatus: "ready",
    read: read === null ? null : { readId: "r", layout: "data360_wide", provenance: {}, seriesCount: 3, observationCount: 607, areaCount: 71, noteCount: 0, publishedAt: "x", failure: null, failedAt: null, ...read },
  });
  it("observations, metadata only, not read and import error", () => {
    expect(fileReadiness(file("dhs", {}))).toMatchObject({ state: "observations_ready", provider: "world_bank", content: "607 observations, 3 series, 71 areas", status: "Ready: charts populated" });
    expect(fileReadiness(file("notes", { layout: "oecd_notes", provenance: { dataRows: 79 }, noteCount: 129, observationCount: 0 }))).toMatchObject({ state: "definitions_only", provider: "oecd", content: "79 metadata rows, 129 English notes, no values" });
    expect(fileReadiness(file("new", null))).toMatchObject({ state: "not_read", provider: null });
    expect(fileReadiness(file("bad", { readId: null, layout: null, failure: "Not a layout." }))).toMatchObject({ state: "import_error", status: "Import error: Not a layout." });
    expect(fileReadiness(file("again", { failure: "Engine down." })).status).toBe("Ready: charts populated. The last attempt to read it again failed; the earlier read is shown");
  });
  it("OECD metadata only and IMF no file provided; an unread file makes absent providers 'no file read'", () => {
    const dhs = fileReadiness(file("dhs", {}));
    const notes = fileReadiness(file("notes", { layout: "oecd_notes", provenance: { dataRows: 79 } }));
    expect(providerLines([dhs, notes]).map((l) => l.text)).toEqual(["World Bank: 1 file with observations", "OECD: metadata only", "IMF: no file provided"]);
    expect(providerLines([dhs, fileReadiness(file("new", null))]).map((l) => l.text)).toEqual(["World Bank: 1 file with observations", "OECD: no file read", "IMF: no file read", "1 file not read: provider not known until read"]);
  });
});

// D6-F01 (Codex review 30 October 2026): direction comes from the unrounded values, shown-value equality from the
// two observations as shown at their own precision, and the change text from the unrounded change rounded once.
// The summary must agree with both shown observations; equality is never inferred from a rounded change.
describe("D6-F01: direction, shown equality and the rounded change are separate", () => {
  const all = { from: null, to: null };
  const summaryOf = (obs: IndicatorObservation[], s: IndicatorSeriesSummary, decimals: number | null) => {
    const h = headlineFigures(observedTrend(obs, "X", s, all, decimals, statuses), s);
    return { h, sum: viewSummary("X", h, []) };
  };
  it("the review's case: 1.04 then 1.06 at one decimal is shown 1.0% and 1.1% and said to rise", () => {
    const { h, sum } = summaryOf([o("X", "2020", "1.04"), o("X", "2021", "1.06")], pct, 1);
    expect([h.previous?.shown, h.latest?.shown]).toEqual(["1.0%", "1.1%"]);
    expect(sum.statement).toBe("For X, the reported value rose from 1.0% in 2020 to 1.1% in 2021.");
    expect(sum.statement).not.toContain("the same");
    expect(h.change).toMatchObject({ direction: "rose", text: "+<0.1 pp", arithmetic: "1.1% minus 1.0%, calculated from the unrounded values" });
  });
  it("a negative difference straddling the rounding boundary is said to fall", () => {
    const { h, sum } = summaryOf([o("X", "2020", "1.06"), o("X", "2021", "1.04")], pct, 1);
    expect(sum.statement).toBe("For X, the reported value fell from 1.1% in 2020 to 1.0% in 2021.");
    expect(h.change).toMatchObject({ direction: "fell", text: "-<0.1 pp" });
  });
  it("genuinely equal shown values with an unrounded rise, and a rounded change of one shown step", () => {
    const { h, sum } = summaryOf([o("X", "2020", "1.05"), o("X", "2021", "1.14")], pct, 1);
    expect([h.previous?.shown, h.latest?.shown]).toEqual(["1.1%", "1.1%"]);
    expect(sum.statement).toBe("For X, the reported value is shown as 1.1% in both 2020 and 2021; unrounded, it rose (change +0.1 pp).");
    expect(h.change).toMatchObject({ direction: "rose", text: "+0.1 pp" });
  });
  it("exact equality is the same value; written at two precisions it names both shown values", () => {
    const same = summaryOf([o("X", "2020", "70.5"), o("X", "2021", "70.5")], pct, null);
    expect(same.sum.statement).toBe("For X, the reported value was the same in 2020 and 2021 (70.5%).");
    const twoPrecisions = summaryOf([o("X", "2020", "70.5"), o("X", "2021", "70.50")], pct, null);
    expect(twoPrecisions.sum.statement).toBe("For X, the reported value was the same in 2020 (70.5%) and 2021 (70.50%).");
    expect(same.h.change).toMatchObject({ direction: "same", text: "0.0 pp" });
    expect(twoPrecisions.h.change).toMatchObject({ direction: "same", text: "0.00 pp" });
  });
  it("differing observation precisions whose shown order disagrees with the unrounded direction say so", () => {
    // 1.04E0 has no written decimals, so it is shown by the display rule (1%); 1.03 is shown as written (1.03%).
    const { h, sum } = summaryOf([o("X", "2020", "1.04E0"), o("X", "2021", "1.03")], pct, null);
    expect([h.previous?.shown, h.latest?.shown]).toEqual(["1%", "1.03%"]);
    expect(sum.statement).toBe("For X, the reported value is shown as 1% in 2020 and 1.03% in 2021, at different precisions; unrounded, it fell (change -0.01 pp).");
    expect(sum.statement).not.toMatch(/rose|the same/);
    expect(h.change?.direction).toBe("fell");
  });
  it("unit scaling: a multiplier and a proportion scale, each straddling the rounding boundary", () => {
    const thousands = { ...pct, unitCode: "USD", unitLabel: "US dollar", unitMult: 3 };
    const k = summaryOf([o("X", "2020", "3.4274999"), o("X", "2021", "3.4275001")], thousands, 3);
    expect([k.h.previous?.shown, k.h.latest?.shown]).toEqual(["3,427", "3,428"]);
    expect(k.sum.statement).toBe("For X, the reported value rose from 3,427 in 2020 to 3,428 in 2021.");
    const proportion = { ...pct, valueScale: "proportion" as const };
    const p = summaryOf([o("X", "2020", "0.01060"), o("X", "2021", "0.01040")], proportion, 3);
    expect([p.h.previous?.shown, p.h.latest?.shown]).toEqual(["1.1%", "1.0%"]);
    expect(p.sum.statement).toBe("For X, the reported value fell from 1.1% in 2020 to 1.0% in 2021.");
    expect(k.h.change).toMatchObject({ direction: "rose", text: "+<1" });
    expect(p.h.change).toMatchObject({ direction: "fell", text: "-<0.1 pp" });
  });
  it("the DHS reference stays +19.7 pp and the wording stays descriptive, never causal", () => {
    const { h, sum } = summaryOf(KEN.map((x) => ({ ...x, areaCode: "X" })), pct, 1);
    expect(sum.statement).toBe("For X, the reported value rose from 70.5% in 2014 to 90.2% in 2022.");
    expect(sum.detail).toBe("This is an 8-year gap between observations. No annual path or statistical significance is inferred.");
    for (const t of [sum.statement, sum.detail]) expect(t).not.toMatch(/because|due to|caused|led to|driven/i);
    expect(h.change).toMatchObject({ direction: "rose", text: "+19.7 pp", arithmetic: "90.2% minus 70.5%" });
  });
});

// D6-F02 (Codex review 30 October 2026): one time axis for every chart of the view, for every accepted period form.
describe("D6-F02: one calendar owner for years, quarters, halves, months, dates and ISO weeks", () => {
  it("dates are one day apart; ISO weeks start on their Monday, across a year boundary", () => {
    expect(periodPosition("2024-01-02")! - periodPosition("2024-01-01")!).toBe(1);
    expect(periodPosition("2024-01-11")! - periodPosition("2024-01-02")!).toBe(9);
    expect(periodPosition("2021-W01")).toBe(periodPosition("2021-01-04"));
    expect(periodPosition("2020-W53")).toBe(periodPosition("2020-12-28"));
    expect(periodPosition("2026-W01")).toBe(periodPosition("2025-12-29"));
    expect(periodPosition("2020-W01")).toBe(periodPosition("2019-12-30"));
    // 2021 has 52 ISO weeks: its week 53 would be 2022-W01, so it is not placed.
    expect(periodPosition("2021-W53")).toBeNull();
    expect(periodPosition("2021-W00")).toBeNull();
  });
  it("one axis over the view's periods; one frequency only; anything unplaceable withholds the axis with the reason", () => {
    const daily = timeAxisOf(["2024-01-01", "2024-01-02", "2024-01-11"]);
    expect(daily).toEqual({ state: "calendar", frequency: "day", min: periodPosition("2024-01-01"), max: periodPosition("2024-01-11") });
    expect(timeAxisOf(["2003", "2008", "2014", "2022"])).toMatchObject({ state: "calendar", frequency: "year" });
    expect(timeAxisOf(["2026-Q1", "2026-Q2"])).toMatchObject({ state: "calendar", frequency: "quarter" });
    expect(timeAxisOf(["2023-M01", "2023-02"])).toMatchObject({ state: "calendar", frequency: "month" });
    expect(timeAxisOf(["2020-W52", "2021-W01"])).toMatchObject({ state: "calendar", frequency: "week" });
    expect(timeAxisOf(["2021-W52", "2021-W53"])).toEqual({ state: "withheld", reason: "Not placed on a time axis: 2021-W53 is not an ISO week of 2021, which has 52 weeks." });
    expect(timeAxisOf(["2023", "2023-Q2"])).toEqual({ state: "withheld", reason: "Not placed on a time axis: the periods mix frequencies (year, quarter), so one axis would misstate their spacing." });
    expect(timeAxisOf(["2023-13"])).toEqual({ state: "withheld", reason: "Not placed on a time axis: 2023-13 is not a real calendar period." });
    expect(timeAxisOf([])).toEqual({ state: "withheld", reason: "Not placed on a time axis: no period is observed in this range." });
  });
  it("a point's place is its share of the common span; one period alone is in the middle; never an index", () => {
    const axis = timeAxisOf(["2024-01-01", "2024-01-02", "2024-01-11"]);
    expect(axisFraction(periodPosition("2024-01-02")!, axis)).toBeCloseTo(0.1, 12);
    expect(axisFraction(periodPosition("2024-01-01")!, axis)).toBe(0);
    expect(axisFraction(periodPosition("2024-01-11")!, axis)).toBe(1);
    expect(axisFraction(periodPosition("2022")!, timeAxisOf(["2022"]))).toBe(0.5);
    expect(axisFraction(periodPosition("2022")!, timeAxisOf(["2021-W53"]))).toBeNull();
    expect(axisFraction(periodPosition("2030")!, axis)).toBeNull();
  });
});
