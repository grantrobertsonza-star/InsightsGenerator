// The checks on the indicator reader's answer before anything is stored (indicatorData.ts,
// validateIndicatorResult, batch 54), and the mirrors that must stay equal to the engine: the number
// rule (STRICT_NUMBER = engine _STRICT_NUMBER) and the suggestion rule in uploadPurposes.ts
// (sampleLooksLikeIndicatorData), which must suggest Indicator data exactly for the fixture files the
// engine reads as indicator data.
import { describe, expect, it, vi } from "vitest";
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn(), withTenantRepeatableRead: vi.fn() }));
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { STRICT_NUMBER, validateIndicatorResult } from "../indicatorData";
import { indicatorPeriodValid } from "../indicatorLayouts";
import { UPLOAD_PURPOSES, sampleLooksLikeIndicatorData, suggestPurposeFor } from "../uploadPurposes";
import { IMPORT_LIMITS, INDICATOR_VALUES_LIMIT_MESSAGE } from "../importLimits";
import { PYTHON } from "./helpers/pythonEngine";

const ok = () => ({
  reader: "engine-indicators-2026.10.28",
  layout: "sdmx_long",
  provenance: {},
  series: [{ key: "k", indicatorCode: "X", indicatorLabel: null, breakdowns: [{ dimension: "SEX", code: "F", label: "Female" }], unitCode: "PT", unitLabel: null, unitMult: 0, valueScale: null, baseDescription: null, groups: null }],
  areas: [{ code: "ZAF", label: "South Africa" }],
  observations: [[0, 0, "2020", "1.5", "A", null]],
});

describe("the reader's answer is checked before it is stored", () => {
  it("accepts a well-formed answer", () => {
    expect(validateIndicatorResult(ok()).observations).toHaveLength(1);
  });
  it.each([
    ["an unknown layout", (r: ReturnType<typeof ok>) => ({ ...r, layout: "guess" }), "unknown layout"],
    ["a value that is not a plain number", (r: ReturnType<typeof ok>) => ({ ...r, observations: [[0, 0, "2020", "1,5", null, null]] }), "not a plain number"],
    ["an empty value (absent observations have no row)", (r: ReturnType<typeof ok>) => ({ ...r, observations: [[0, 0, "2020", "", null, null]] }), "not a plain number"],
    ["an observation of an unknown series", (r: ReturnType<typeof ok>) => ({ ...r, observations: [[3, 0, "2020", "1", null, null]] }), "unknown series"],
    ["an observation of an unknown area", (r: ReturnType<typeof ok>) => ({ ...r, observations: [[0, 1, "2020", "1", null, null]] }), "unknown area"],
    ["two values for one observation", (r: ReturnType<typeof ok>) => ({ ...r, observations: [[0, 0, "2020", "1", null, null], [0, 0, "2020", "2", null, null]] }), "two values"],
    ["a repeated series key", (r: ReturnType<typeof ok>) => ({ ...r, series: [r.series[0], r.series[0]] }), "unique key"],
    ["a unit multiplier that is not whole", (r: ReturnType<typeof ok>) => ({ ...r, series: [{ ...r.series[0], unitMult: 1.5 }] }), "unit multiplier"],
    ["an unknown scale", (r: ReturnType<typeof ok>) => ({ ...r, series: [{ ...r.series[0], valueScale: "per mille" }] }), "value scale"],
    ["notes in a data file", (r: ReturnType<typeof ok>) => ({ ...r, notes: [{ key: {}, keyLabels: {}, period: null, field: "F", fieldLabel: null, text: "t", line: 2 }] }), "notes in a data file"],
    ["a notes file with observations", (r: ReturnType<typeof ok>) => ({ ...r, layout: "oecd_notes", provenance: { dataflow: "D" }, notes: [{ key: {}, keyLabels: {}, period: null, field: "F", fieldLabel: null, text: "t", line: 2 }] }), "notes with observations"],
    ["a notes file without a dataflow", (r: ReturnType<typeof ok>) => ({ ...r, layout: "oecd_notes", series: [], areas: [], observations: [], notes: [{ key: {}, keyLabels: {}, period: null, field: "F", fieldLabel: null, text: "t", line: 2 }] }), "without a dataflow"],
    ["a malformed note", (r: ReturnType<typeof ok>) => ({ ...r, layout: "oecd_notes", series: [], areas: [], observations: [], provenance: { dataflow: "D" }, notes: [{ key: { REF_AREA: 1 }, keyLabels: {}, period: null, field: "F", fieldLabel: null, text: "t", line: 2 }] }), "a malformed note"],
  ])("refuses %s", (_name, edit, message) => {
    expect(() => validateIndicatorResult(edit(ok()))).toThrow(message);
  });
});

describe("mirrors of the engine rules", () => {
  it("the number rule is the engine's _STRICT_NUMBER", () => {
    const engine = readFileSync(path.join(process.cwd(), "api", "parse-stats-file.py"), "utf8");
    const m = engine.match(/^_STRICT_NUMBER = re\.compile\(r"(.+)"\)$/m);
    expect(m?.[1]).toBe(STRICT_NUMBER.source);
  });

  const FIX = path.join(process.cwd(), "fixtures", "indicator-data");
  const csvFixtures = readdirSync(FIX).filter((f) => f.endsWith(".csv"));
  const engineOk = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;

  it("the upload suggestion recognises the fixtures the reader recognises, and only those", () => {
    const suggested = Object.fromEntries(csvFixtures.map((f) => [f, sampleLooksLikeIndicatorData(readFileSync(path.join(FIX, f)).subarray(0, 8192).toString("utf8"))]));
    expect(suggested).toEqual({
      "DHS_SD.csv": true,
      "DHS_SD_DATADICT.csv": false,
      "DHS_SD_WIDEF.csv": true,
      "IMF_STA_IL_slice.csv": true,
      "IMF_STA_WPAIAX_slice.csv": true,
      "OECD_FDI_INC_AGGR_filtered_slice.csv": true,
      // Notes keyed by dimension values: read as notes for the data of the same dataflow.
      "OECD_FDI_INC_AGGR_reference.csv": true,
      "WB_FINDATA_WIDEF.csv": true,
      "WDI_layout_synthetic.csv": true,
      "findex_ZAF_2024_indicator_percent.csv": true,
      "findex_ZAF_2024_indicator_percent_by_topic.csv": true,
    });
    if (!engineOk) return;
    const script = [
      "import importlib.util, json, os, sys",
      "spec = importlib.util.spec_from_file_location('p', 'api/parse-stats-file.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "out = {}",
      "for f in sys.argv[1:]:",
      "    try:",
      "        m.indicator_observations(open(os.path.join('fixtures/indicator-data', f), 'rb').read(), f); out[f] = True",
      "    except ValueError:",
      "        out[f] = False",
      "print(json.dumps(out))",
    ].join("\n");
    const r = spawnSync(PYTHON, ["-c", script, ...csvFixtures], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual(suggested);
  });

  // Codex NEW10K-F01: months 00 and 13 had the SDMX shape, were stored, and the chart moved month 13 to the
  // next January with no value. The engine, the server and the chart now share one calendar rule.
  const PERIODS: [string, boolean][] = [
    ["2024", true], ["2024-Q1", true], ["2024-Q4", true], ["2024-S2", true],
    ["2024-M01", true], ["2024-M12", true], ["2024-01", true], ["2024-12", true],
    ["2024-M00", false], ["2024-M13", false], ["2024-00", false], ["2024-13", false], ["2024-M99", false],
    ["2024-W01", true], ["2024-W53", true], ["2024-W00", false], ["2024-W54", false],
    ["2024-02-29", true], ["2023-02-29", false], ["2024-04-31", false], ["2024-12-31", true],
    ["2024-Q5", false], ["FY2024", false], ["2024-M1", false], ["", false],
  ];
  it("one calendar rule for periods: engine and server agree, months run 01 to 12", () => {
    expect(PERIODS.map(([p]) => [p, indicatorPeriodValid(p)])).toEqual(PERIODS);
    if (!engineOk) return;
    const script = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('p', 'api/parse-stats-file.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "out = []",
      "for p in json.loads(sys.argv[1]):",
      "    try:",
      "        m._ind_period(p, 'x'); out.append([p, True])",
      "    except ValueError:",
      "        out.append([p, False])",
      "print(json.dumps(out))",
    ].join("\n");
    const r = spawnSync(PYTHON, ["-c", script, JSON.stringify(PERIODS.map(([p]) => p))], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual(PERIODS);
  });

  it("a file with month 13 or month 00 is refused by the engine, naming the period; months 01 and 12 are read", () => {
    if (!engineOk) return;
    const file = (period: string) => `FREQ,REF_AREA,INDICATOR,UNIT_MEASURE,TIME_PERIOD,OBS_VALUE\nM,ZAF,ACCESS,PT,${period},50\n`;
    const script = [
      "import importlib.util, json, sys",
      "spec = importlib.util.spec_from_file_location('p', 'api/parse-stats-file.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
      "out = {}",
      "for name, text in json.loads(sys.argv[1]).items():",
      "    try:",
      "        r = m.indicator_observations(text.encode(), name + '.csv'); out[name] = [o[2] for o in r['observations']]",
      "    except ValueError as e:",
      "        out[name] = str(e)",
      "print(json.dumps(out))",
    ].join("\n");
    const files = { m13: file("2024-M13"), m00: file("2024-M00"), m12: file("2024-M12"), m01: file("2025-M01") };
    const r = spawnSync(PYTHON, ["-c", script, JSON.stringify(files)], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout.trim());
    expect(out.m13).toMatch(/'2024-M13', which is not a real month/);
    expect(out.m00).toMatch(/'2024-M00', which is not a real month/);
    expect(out.m12).toEqual(["2024-M12"]);
    expect(out.m01).toEqual(["2025-M01"]);
  });

  it("the server refuses a stored period the engine would refuse", () => {
    const answer = (period: string) => ({
      reader: "x", layout: "sdmx_long", provenance: {},
      series: [{ key: "s", indicatorCode: "ACCESS", indicatorLabel: null, breakdowns: [], unitCode: null, unitLabel: null, baseDescription: null, unitMult: null, valueScale: null, groups: null }],
      areas: [{ code: "ZAF", label: null }],
      observations: [[0, 0, period, "50", null, null]],
    });
    expect(() => validateIndicatorResult(answer("2024-M13"))).toThrow(/not a real year, quarter, half, week, month or date \(2024-M13\)/);
    expect(() => validateIndicatorResult(answer("2024-M12"))).not.toThrow();
  });

  it("the values limit message is the engine's, word for word, and the upload hint states the limit", () => {
    if (!engineOk) return;
    const r = spawnSync(PYTHON, ["-c", "import importlib.util; s = importlib.util.spec_from_file_location('p', 'api/parse-stats-file.py'); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.INDICATOR_VALUES_LIMIT_MESSAGE)"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe(INDICATOR_VALUES_LIMIT_MESSAGE);
    expect(INDICATOR_VALUES_LIMIT_MESSAGE).toContain(`${IMPORT_LIMITS.maxIndicatorValues.toLocaleString("en-GB")} values for indicator data`);
    expect(UPLOAD_PURPOSES.find((p) => p.id === "indicator")?.hint).toContain(`${IMPORT_LIMITS.maxIndicatorValues.toLocaleString("en-GB")} values per file`);
    // Raw data keeps its case limit.
    expect(UPLOAD_PURPOSES.find((p) => p.id === "raw")?.hint).toContain(`${IMPORT_LIMITS.maxCases.toLocaleString("en-GB")} cases per file`);
  });

  it("the suggestion applies to CSV, TSV and text files from their first lines, before the name rules for tables", () => {
    const dhs = readFileSync(path.join(FIX, "DHS_SD.csv")).subarray(0, 8192).toString("utf8");
    expect(suggestPurposeFor("DHS_SD.csv").id).toBe("raw");
    expect(suggestPurposeFor("DHS_SD.csv", dhs)).toMatchObject({ id: "indicator", reason: expect.stringContaining("published statistics") });
    expect(suggestPurposeFor("WB tables.csv", dhs).id).toBe("indicator");
    const tsv = dhs.split("\n").map((l) => l.replace(/","/g, '"\t"')).join("\n");
    expect(suggestPurposeFor("DHS_SD.tsv", tsv).id).toBe("indicator");
    expect(suggestPurposeFor("DHS_SD.txt", dhs).id).toBe("indicator");
    const dict = readFileSync(path.join(FIX, "DHS_SD_DATADICT.csv")).toString("utf8");
    expect(suggestPurposeFor("DHS_SD_DATADICT.csv", dict).id).not.toBe("indicator");
    expect(suggestPurposeFor("survey.csv", "id,age,q1\n1,34,2\n").id).toBe("raw");
    // A codebook or questionnaire named as such keeps its name rule.
    expect(suggestPurposeFor("data dictionary.csv", dhs).id).toBe("codebook");
  });
});
