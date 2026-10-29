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
  it("places years, quarters, halves and months on the calendar; other spellings have no position", () => {
    expect([periodPosition("2008"), periodPosition("2023-Q2"), periodPosition("2023-S2"), periodPosition("2023-M04"), periodPosition("2023-04"), periodPosition("2023-W05"), periodPosition("2023-13")]).toEqual([2008, 2023.25, 2023.5, 2023.25, 2023.25, null, null]);
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
    expect(changeBetween(a, b, pct)).toMatchObject({ text: "0.0 pp", periodsText: "2021 vs 2020, consecutive years" });
    const usd = { ...pct, unitCode: "USD", unitLabel: "US dollar", valueScale: null };
    const [c, d] = observedTrend([o("X", "2019", "10.25"), o("X", "2023", "9.75")], "X", usd, { from: null, to: null }, null, statuses);
    expect(changeBetween(c, d, usd)).toMatchObject({ text: "-0.50", unitWords: "in the series' unit (US dollar (USD))" });
    const h = headlineFigures([a, b], pct);
    expect(viewSummary("X", h, []).statement).toBe("For X, the reported value was the same at the shown precision in 2020 and 2021 (70.5%).");
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
