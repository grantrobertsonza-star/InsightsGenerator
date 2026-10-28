// How Indicator data is shown (indicatorDisplay.ts, batch 54): series chosen by codes, the shown value
// (proportions times 100, the unit multiplier) never changing the stored one, gaps for missing years
// (never zero), the CSV of what is shown, and request order (a late answer never replaces a newer choice).
import { describe, expect, it } from "vitest";
import { csvNumberField } from "../csvField";
import type { IndicatorNote, IndicatorSeriesSummary } from "../indicatorData";
import {
  noteText,
  notesFor,
  datasetLines,
  withheldCells,
  breakdownChoices,
  chartPoints,
  createRequestOrder,
  indicatorCsv,
  indicatorOptions,
  periodAxis,
  seriesFor,
  shownNumber,
  shownText,
  sourceText,
  unitText,
} from "../indicatorDisplay";

const base: Omit<IndicatorSeriesSummary, "id" | "key" | "breakdowns"> = {
  indicatorCode: "FD_FDI_OVRL",
  indicatorLabel: "Financial Development Index (FinData)",
  unitCode: "0_TO_100",
  unitLabel: "0-100 scale",
  unitMult: 0,
  valueScale: null,
  baseDescription: null,
  groups: null,
  observationCount: 2,
  areaCodes: ["USA", "ZAF"],
};
const b = (dimension: string, code: string, label: string | null = null) => ({ dimension, code, label });
const series: IndicatorSeriesSummary[] = [
  { ...base, id: "s1", key: "1", breakdowns: [b("FREQ", "A", "Annual"), b("EV_CRITERIA", "_T", "Overall"), b("SEGMENT", "FM", "Financial Markets")] },
  { ...base, id: "s2", key: "2", breakdowns: [b("FREQ", "A", "Annual"), b("EV_CRITERIA", "_T", "Overall"), b("SEGMENT", "BK", "Banks")] },
  { ...base, id: "s3", key: "3", breakdowns: [b("FREQ", "A", "Annual"), b("EV_CRITERIA", "AC", "Access"), b("SEGMENT", "FM", "Financial Markets")] },
  { ...base, id: "s4", key: "4", indicatorCode: "FD_SCOBIS01", indicatorLabel: "Bank Z-score", breakdowns: [b("FREQ", "A", "Annual")] },
];

describe("choosing a series", () => {
  it("lists each indicator once and offers only the breakdowns that vary, by code", () => {
    expect(indicatorOptions(series)).toEqual([
      { key: "code:FD_FDI_OVRL", name: "Financial Development Index (FinData) (FD_FDI_OVRL)" },
      { key: "code:FD_SCOBIS01", name: "Bank Z-score (FD_SCOBIS01)" },
    ]);
    const choices = breakdownChoices(series, "code:FD_FDI_OVRL");
    expect(choices.map((c) => c.dimension)).toEqual(["EV_CRITERIA", "SEGMENT"]);
    expect(choices[1].values).toEqual([{ code: "FM", label: "Financial Markets (FM)" }, { code: "BK", label: "Banks (BK)" }]);
    expect(breakdownChoices(series, "code:FD_SCOBIS01")).toEqual([]);
  });

  it("finds the series by breakdown codes; an unpicked dimension takes its first value", () => {
    expect(seriesFor(series, "code:FD_FDI_OVRL", { EV_CRITERIA: "_T", SEGMENT: "BK" })?.id).toBe("s2");
    expect(seriesFor(series, "code:FD_FDI_OVRL", { EV_CRITERIA: "AC" })?.id).toBe("s3");
    expect(seriesFor(series, "code:FD_FDI_OVRL", {})?.id).toBe("s1");
    // A combination the file does not have is no series, never a neighbour.
    expect(seriesFor(series, "code:FD_FDI_OVRL", { EV_CRITERIA: "AC", SEGMENT: "BK" })).toBeNull();
    // Same label, different codes: identity is the code.
    const same = [{ ...series[0], id: "x", indicatorCode: "A1", indicatorLabel: "Same" }, { ...series[0], id: "y", indicatorCode: "A2", indicatorLabel: "Same" }];
    expect(indicatorOptions(same).map((o) => o.key)).toEqual(["code:A1", "code:A2"]);
  });
});

describe("values as shown", () => {
  const proportion = { ...base, valueScale: "proportion" as const, unitCode: "%", unitLabel: "Percent", unitMult: null, baseDescription: "age 15+" };
  it("a proportion is shown as a percentage, the value as written is unchanged", () => {
    expect(shownNumber("0.811259662052011", proportion)).toBeCloseTo(81.1259662052011, 12);
    expect(shownText(shownNumber("0.811259662052011", proportion), proportion)).toBe("81.1%");
    expect(unitText(proportion)).toBe("Unit: Percent (%); base: age 15+; stored as proportions from 0 to 1 and shown as percentages (0.811 is shown as 81.1%)");
  });
  it("the unit multiplier is applied for display and stated", () => {
    const thousands = { ...base, unitCode: "USD", unitLabel: "US dollars", unitMult: 3 };
    expect(shownNumber("1.5", thousands)).toBe(1500);
    expect(unitText(thousands)).toContain("values shown multiplied by 10 to the power 3 (the file's unit multiplier)");
    expect(unitText({ ...base, unitCode: null, unitLabel: null, unitMult: null })).toBe("Unit: not stated in the file");
  });
});

describe("the time axis", () => {
  it("runs every year from the first to the last, so a missing year is a gap", () => {
    expect(periodAxis(["2016", "2011", "2016", "2005"])).toEqual(["2005", "2006", "2007", "2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016"]);
    expect(periodAxis(["2015-Q2", "2015-Q1"])).toEqual(["2015-Q1", "2015-Q2"]);
    // Quarters and months run through every period too (IMF and OECD), across a year boundary.
    expect(periodAxis(["2015-Q4", "2016-Q2"])).toEqual(["2015-Q4", "2016-Q1", "2016-Q2"]);
    expect(periodAxis(["2023-M11", "2024-M02"])).toEqual(["2023-M11", "2023-M12", "2024-M01", "2024-M02"]);
    expect(periodAxis(["2023-11", "2024-01"])).toEqual(["2023-11", "2023-12", "2024-01"]);
    expect(periodAxis(["2024", null])).toEqual(["2024", null]);
  });
  it("a year with no value is null in the chart, never zero; areas keep their own values", () => {
    const pts = chartPoints(
      [
        { areaCode: "ZAF", period: "2016", valueText: "89.8", status: "A", note: null },
        { areaCode: "COG", period: "2011", valueText: "84.4", status: "A", note: null },
        { areaCode: "COG", period: "2014", valueText: "0", status: "A", note: null },
      ],
      ["ZAF", "COG"],
      [{ code: "ZAF", label: "South Africa" }, { code: "COG", label: "Congo, Rep." }],
      series[0],
    );
    expect(pts).toHaveLength(12);
    const at = (area: string, period: string) => pts.find((p) => p.area.startsWith(area) && p.period === period)?.value;
    expect(at("South Africa", "2016")).toBe(89.8);
    expect(at("South Africa", "2011")).toBeNull();
    expect(at("Congo", "2011")).toBe(84.4);
    expect(at("Congo", "2012")).toBeNull();
    // A real zero in the file stays zero.
    expect(at("Congo", "2014")).toBe(0);
  });
});

describe("the CSV of what is shown", () => {
  it("one line per observation with the value as written and as shown, the unit, status and source; text is formula-safe", () => {
    const s = { ...series[0], indicatorLabel: "=HYPERLINK(\"x\")" };
    const csv = indicatorCsv({
      series: s,
      areas: [{ code: "USA", label: "United States" }],
      observations: [{ areaCode: "USA", period: "2006", valueText: "71.9801025390625", status: "A", note: null }, { areaCode: "USA", period: "2007", valueText: "-5.1E-4", status: "O", note: "estimate, revised" }],
      statuses: { A: "Normal value", O: "Missing value" },
      source: sourceText({ sources: [{ code: "WB_FINDATA", label: "Financial Development Indicators (FinData)" }] }, "WB_FINDATA_WIDEF.csv"),
    });
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("area_code,area,indicator_code,indicator,FREQ,FREQ_label,EV_CRITERIA,EV_CRITERIA_label,SEGMENT,SEGMENT_label,period,value_as_written,value_shown,unit_code,unit,unit_multiplier,value_scale,base,status,status_label,note,source");
    expect(lines[1]).toBe(`USA,United States (USA),FD_FDI_OVRL,"'=HYPERLINK(""x"")",A,Annual,_T,Overall,FM,Financial Markets,2006,71.9801025390625,71.9801025390625,0_TO_100,0-100 scale,0,,,A,Normal value,,"Source: Financial Development Indicators (FinData) (WB_FINDATA), file WB_FINDATA_WIDEF.csv"`);
    // A negative number keeps its sign as a number; text that only looks numeric would not.
    expect(lines[2]).toContain(",-5.1E-4,-0.00051,");
    expect(lines[2]).toContain(',O,Missing value,"estimate, revised",');
    expect(csvNumberField("-2.5")).toBe("-2.5");
    expect(csvNumberField("=1+1")).toBe("'=1+1");
  });
});

describe("dataset description and withheld values", () => {
  it("the IMF dataset description becomes lines under the source", () => {
    expect(datasetLines({ dataset: { PUBLISHER: "International Monetary Fund (IMF)", DEPARTMENT: "Statistics Department (STA)", UPDATE_DATE: "2026-10-28", SUGGESTED_CITATION: "IMF (2026).", LICENSE: "Copyright IMF" } })).toEqual([
      "Publisher: International Monetary Fund (IMF), Statistics Department (STA)",
      "Updated: 2026-10-28",
      "Citation: IMF (2026).",
      "Licence: Copyright IMF",
    ]);
    expect(datasetLines({})).toEqual([]);
  });
  it("withheld cells are found for the series and chosen areas only, and written to the CSV with no value", () => {
    const prov = { withheld: [["k1", "EST", "2026-Q1"], ["k1", "LVA", "2026-Q1"], ["k2", "EST", "2026-Q2"]] };
    expect([...withheldCells(prov, "k1", ["EST"])]).toEqual(["EST\u00002026-Q1"]);
    const csv = indicatorCsv({ series: series[0], areas: [{ code: "EST", label: "Estonia" }], observations: [], statuses: {}, source: "Source: x", withheld: [{ areaCode: "EST", period: "2026-Q1" }] });
    expect(csv.split("\r\n")[1]).toBe("EST,Estonia (EST),FD_FDI_OVRL,Financial Development Index (FinData),A,Annual,_T,Overall,FM,Financial Markets,2026-Q1,,,0_TO_100,0-100 scale,0,,,,,Withheld by the publisher as confidential,Source: x");
  });
});

describe("notes (OECD reference information)", () => {
  const note = (key: Record<string, string>, field = "STAT_CONC_DEF", period: string | null = null): IndicatorNote => ({ fileName: "ref.csv", key, keyLabels: key.REF_AREA === "NLD" ? { REF_AREA: "Netherlands" } : ({} as Record<string, string>), period, field, fieldLabel: field === "DATA_SOURCE" ? "Data source" : "Statistical concepts and definitions", text: `text for ${JSON.stringify(key)}` });
  const fdi = { indicatorCode: "T_D4P_F", breakdowns: [b("FREQ", "Q"), b("UNIT_MEASURE", "RC"), b("TYPE_ENTITY", "ALL"), b("FDI_COLLECTION_ID", "AGGR"), b("CURRENCY", "EUR")] };
  const notes = [
    note({ REF_AREA: "NLD", MEASURE: "T_D4P_F", FDI_COLLECTION_ID: "AGGR" }, "DATA_SOURCE", "2009"),
    note({ MEASURE: "T_D4P_F" }),
    note({ TYPE_ENTITY: "ALL" }),
    note({ TYPE_ENTITY: "RSP" }),
    note({ MEASURE: "T_D4S_F5" }),
    note({ SEASONAL_FACTOR: "X" }),
  ];
  it("a note applies when every dimension it names matches; '~' (not named) matches any; an area note only to that area", () => {
    expect(notesFor(notes, fdi, ["NLD", "DEU"]).map((n) => n.key)).toEqual([{ REF_AREA: "NLD", MEASURE: "T_D4P_F", FDI_COLLECTION_ID: "AGGR" }, { MEASURE: "T_D4P_F" }, { TYPE_ENTITY: "ALL" }]);
    // Without NLD charted, the NLD note does not apply; the "any area" notes still do.
    expect(notesFor(notes, fdi, ["DEU", "CHE"]).map((n) => n.key)).toEqual([{ MEASURE: "T_D4P_F" }, { TYPE_ENTITY: "ALL" }]);
    expect(noteText(notesFor(notes, fdi, ["NLD"])[0])).toBe('Data source (Netherlands (NLD), 2009): text for {"REF_AREA":"NLD","MEASURE":"T_D4P_F","FDI_COLLECTION_ID":"AGGR"}');
  });
  it("the CSV has a notes section after the values", () => {
    const csv = indicatorCsv({ series: series[0], areas: [], observations: [], statuses: {}, source: "s", notes: [notes[0]] });
    const lines = csv.split("\r\n");
    expect(lines.slice(1, 4)).toEqual(["", "notes_file,field,field_label,area_code,period,note", 'ref.csv,DATA_SOURCE,Data source,NLD,2009,"text for {""REF_AREA"":""NLD"",""MEASURE"":""T_D4P_F"",""FDI_COLLECTION_ID"":""AGGR""}"']);
  });
});

describe("request order", () => {
  it("only the latest request's answer may be shown", () => {
    const order = createRequestOrder();
    const first = order.next();
    const second = order.next();
    expect(order.isLatest(first)).toBe(false);
    expect(order.isLatest(second)).toBe(true);
  });
});
