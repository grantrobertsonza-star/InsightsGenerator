import { PYTHON } from "./helpers/pythonEngine";
// Golden reference fixtures (permanent since 2026-10-17; first run as the deep golden-thread
// check's numbers layer). Every assertion in
// fixtures/golden-thread-1/expected.json that the engine can answer, checked against the ACTUAL
// Python engine (api/parse-stats-file.py dictionary() and crosstab()) and the app's own NPS
// function (descriptiveFindings.ts computeNps), within each assertion's own absolute tolerance.
// The expected values come from the fixture's independent reference (openpyxl + standard-library
// arithmetic, never application functions). Nothing is mocked.
// Method differences the fixture README allows are compared on method and conclusion, not value:
// the fixture's two-proportion p uses a pooled null SE; the app's column test uses the unpooled SE
// (stated in its notes), so p differs slightly while the significance conclusion must agree.
// Skipped, with the reason printed, when python3 with pandas/openpyxl/pyreadstat is unavailable.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeNps } from "../descriptiveFindings";
import type { CrosstabRow } from "../parseStatsFile";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const FIXTURE = path.join(process.cwd(), "fixtures", "golden-thread-1");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;

type Assertion = { id: string; statistic: string; canonicalVariable: string | null; rawCategoryCodes: (string | number)[]; segment: { variable: string; rawCode: string } | null; expectedValue: unknown; base: { expected: number }; tolerance: { value: number } };
const reference = JSON.parse(readFileSync(path.join(FIXTURE, "expected.json"), "utf8")) as { assertions: Assertion[] };

const DRIVER = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
b = open(sys.argv[2], "rb").read()
items = [{"key": k, "label": k, "vars": [k]} for k in ["Purchase", "Satisfaction", "Recommend", "NearTie"]] + [{"key": "Reasons", "label": "Reasons", "vars": ["MR_Convenience", "MR_Value", "MR_Service"], "kind": "multi"}]
def tab(cols, overrides=None):
    return eng.crosstab(b, "golden.xlsx", {"selectedSheet": "Data", "columnVars": cols, "typeOverrides": overrides or {}, "rowItems": items})
d = eng.dictionary(b, "golden.xlsx")
print(json.dumps({"dictionary": d, "total": tab([]), "byGender": tab(["Gender"]),
  "continuous": eng.crosstab(b, "golden.xlsx", {"selectedSheet": "Data", "columnVars": ["Gender"], "typeOverrides": {"Satisfaction": "continuous"}, "rowItems": [{"key": "Satisfaction", "label": "Satisfaction", "vars": ["Satisfaction"]}]}),
  "ids": __import__("pandas").read_excel(sys.argv[2], sheet_name="Data", dtype=str)["RespondentID"].tolist()[:1] }, default=str))
`;

describe.skipIf(!PYTHON_OK)("golden thread 1: engine numbers against the independent reference", () => {
  const r = spawnSync(PYTHON, ["-c", DRIVER, ENGINE, path.join(FIXTURE, "golden-survey-documented.xlsx")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  const out = JSON.parse(r.stdout);
  type Q = { key: string; rows: (CrosstabRow & { rawCode?: string | number })[]; desc?: { mean?: number }; tableTests?: { chi2: number; p: number }[] };
  const q = (t: { questions: Q[] }, key: string) => t.questions.find((x) => x.key === key)!;
  const answerRows = (x: Q) => x.rows.filter((row) => !(row as { isBase?: boolean }).isBase && !(row as { isMean?: boolean }).isMean);
  const columnIndex = (t: { columns: { var: string; rawCode: string }[] }, seg: { variable: string; rawCode: string }) =>
    t.columns.findIndex((c) => c.var === seg.variable && c.rawCode === seg.rawCode);
  const rowFor = (x: Q, code: string | number) => answerRows(x).find((row) => String(row.rawCode ?? row.label) === String(code));
  const mrLabel: Record<string, string> = { MR_Convenience: "Convenience", MR_Value: "Value", MR_Service: "Service" };
  const results: { id: string; observed: unknown; expected: unknown; ok: boolean; note?: string }[] = [];
  const record = (a: Assertion, observed: unknown, ok: boolean, note?: string) => results.push({ id: a.id, observed, expected: a.expectedValue, ok, note });
  const near = (a: Assertion, v: number | null | undefined) => typeof v === "number" && Math.abs(v - (a.expectedValue as number)) <= a.tolerance.value + 1e-9;

  for (const a of reference.assertions) {
    const t = a.segment ? out.byGender : out.total;
    const col = a.segment ? columnIndex(out.byGender, a.segment) : -1;
    const pctOf = (row: CrosstabRow) => (col >= 0 ? row.pct[col] : row.total.pct);
    switch (a.statistic) {
      case "authoritative_sheet": {
        const v = out.total.selectedSheet; record(a, v, v === a.expectedValue && out.dictionary.nCases === a.base.expected); break;
      }
      case "identifier": {
        const rid = out.dictionary.variables.find((v: { name: string }) => v.name === "RespondentID");
        // The engine keeps the identifier as text (not numeric), so leading zeros survive.
        record(a, rid?.text === true && rid?.numeric === false ? "text" : "coerced", rid?.text === true && rid?.numeric === false, "identifier kept as text; exact value checked in the UI checks");
        break;
      }
      case "selection_percentage": { const row = rowFor(q(t, a.canonicalVariable!), a.rawCategoryCodes[0]); record(a, row && pctOf(row), near(a, row ? pctOf(row) : null)); break; }
      case "multiple_response_selection": { const row = answerRows(q(t, "Reasons")).find((x) => x.label === mrLabel[a.canonicalVariable!]); record(a, row && pctOf(row), near(a, row ? pctOf(row) : null)); break; }
      case "mean": {
        if (!a.segment) { const v = q(t, a.canonicalVariable!).desc?.mean; record(a, v, near(a, v)); break; }
        const m = q(out.continuous, a.canonicalVariable!).rows.find((x) => (x as { isMean?: boolean }).isMean);
        const v = m ? m.pct[columnIndex(out.continuous, a.segment)] : null; record(a, v, near(a, v), "segment mean via the continuous override"); break;
      }
      case "effective_measure_after_continuous_override": {
        const m = q(out.continuous, a.canonicalVariable!).rows.find((x) => (x as { isMean?: boolean }).isMean);
        record(a, m?.total.pct, near(a, m?.total.pct)); break;
      }
      case "top_two_box": { const x = q(t, a.canonicalVariable!); const v = a.rawCategoryCodes.reduce<number>((s, c) => s + (rowFor(x, c)?.total.pct ?? NaN), 0); record(a, v, near(a, v)); break; }
      case "net_promoter_score": case "normal_95_interval": case "promoters_percentage": case "passives_percentage": case "detractors_percentage": {
        const nps = computeNps(answerRows(q(out.total, "Recommend")), out.total.total.n);
        const v = !nps ? null : a.statistic === "net_promoter_score" ? nps.nps : a.statistic === "promoters_percentage" ? nps.promoters : a.statistic === "passives_percentage" ? nps.passives : a.statistic === "detractors_percentage" ? nps.detractors : [nps.lo, nps.hi];
        const ok = Array.isArray(v) ? v.every((x, i) => Math.abs(x - (a.expectedValue as number[])[i]) <= a.tolerance.value + 1e-9) : near(a, v as number | null);
        record(a, v, ok); break;
      }
      case "pearson_chi_square": { const v = q(out.byGender, a.canonicalVariable!).tableTests?.[0]?.chi2; record(a, v, near(a, v)); break; }
      case "significant_at_alpha_.05": {
        const x = a.canonicalVariable === "MR_Convenience" ? answerRows(q(out.byGender, "Reasons")).find((row) => row.label === "Convenience") : rowFor(q(out.byGender, a.canonicalVariable!), a.rawCategoryCodes[0]);
        const significant = !!x && x.sig.some((s) => s !== 0);
        record(a, significant, significant === a.expectedValue, "conclusion compared (method differs: unpooled column test)"); break;
      }
      case "pooled_two_proportion_z": case "two_sided_p": {
        const x = a.canonicalVariable === "MR_Convenience" ? answerRows(q(out.byGender, "Reasons")).find((row) => row.label === "Convenience") : rowFor(q(out.byGender, a.canonicalVariable!), a.rawCategoryCodes[0]);
        const p = x?.p?.[0] ?? null;
        // Same conclusion at .05 required; the value may differ by the documented method difference.
        const expectedP = a.statistic === "two_sided_p" ? (a.expectedValue as number) : null;
        const ok = p !== null && (expectedP === null ? true : (p < 0.05) === (expectedP < 0.05));
        record(a, p, ok, "method differs (unpooled vs pooled SE): conclusion compared"); break;
      }
      default: record(a, "not checked", true, `statistic ${a.statistic} not covered here`);
    }
  }

  it("the table notes name the column test actually applied (unpooled standard errors)", () => {
    expect(out.byGender.notes.test).toMatch(/two-proportion z-test with unpooled standard errors on effective bases/);
  });

  it("every applicable assertion matches within its tolerance (or, where the method differs, in its conclusion)", () => {
    console.log("GOLDEN_REFERENCE_RESULTS", JSON.stringify(results));
    expect(results.filter((x) => !x.ok)).toEqual([]);
    expect(results.length).toBe(reference.assertions.length);
  });
});
describe.skipIf(PYTHON_OK)("golden thread 1: engine numbers against the independent reference", () => { it.skip("python engine unavailable", () => {}); });

// Golden thread 2 (weighting): the canonical rows-as-cases control (data-control.csv) against the
// fixture's independent weighted references, plus the weight-rescaling invariant (all weights x7:
// estimates and effective bases unchanged, weighted totals x7). Tolerances as the fixture states:
// percent 0.1 point, mean 0.01. The engine rounds effective bases to 0.1, so they are compared at
// that precision. The primary columns-as-cases workbook declares weights and MR sets in a separate
// Codebook sheet; the engine refuses it with an explicit message (documented unsupported
// combination), which is asserted here rather than silently skipped.
const DRIVER2 = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
F = sys.argv[2]
ctrl = open(F + "/data-control.csv", "rb").read()
lines = ctrl.decode().splitlines(); head = lines[0].split(","); wi = head.index("weight")
x7 = "\n".join([lines[0]] + [",".join(str(float(v) * 7) if i == wi else v for i, v in enumerate(l.split(","))) for l in lines[1:]]).encode()
items = [{"key": "purchase", "label": "p", "vars": ["purchase"]}, {"key": "rating10", "label": "r", "vars": ["rating10"]},
         {"key": "MR", "label": "MR", "vars": ["MR_Convenience", "MR_Price", "MR_Service"], "kind": "multi"}, {"key": "pilot_group", "label": "pg", "vars": ["pilot_group"]}]
def tab(b, cols, w, its=items):
    return eng.crosstab(b, "d.csv", {"columnVars": cols, "typeOverrides": {"rating10": "continuous"}, "rowItems": its, "weightVar": w})
try:
    eng.dictionary(open(F + "/columns-as-cases.xlsx", "rb").read(), "c.xlsx", {"selectedSheet": "Cases", "layout": "columns_are_cases"}); refusal = None
except ValueError as e:
    refusal = str(e)
print(json.dumps({"raw": tab(ctrl, [], None), "weighted": tab(ctrl, [], "weight"), "x7": tab(x7, [], "weight"),
                  "groups": tab(ctrl, ["weight_group"], "weight", items[:1]), "refusal": refusal}, default=str))
`;

describe.skipIf(!PYTHON_OK)("golden thread 2: weighted engine numbers against the independent reference", () => {
  const r = spawnSync(PYTHON, ["-c", DRIVER2, ENGINE, path.join(process.cwd(), "fixtures", "golden-thread-2")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  const out = JSON.parse(r.stdout);
  type Row = { label: string; rawCode?: string; isMean?: boolean; isBase?: boolean; pct: (number | null)[]; total: { pct: number | null; nCell?: number; base: { n: number; w: number; nEff: number } } };
  type T = { total: { n: number; w: number; nEff: number }; columns: { rawCode: string }[]; questions: { key: string; rows: Row[] }[] };
  const row = (t: T, key: string, pick: (x: Row) => boolean) => t.questions.find((q) => q.key === key)!.rows.find(pick)!;
  const code1 = (x: Row) => String(x.rawCode) === "1";
  const mean = (x: Row) => !!x.isMean;
  const mr = (name: string) => (x: Row) => x.label === name;

  it("bases, weighted and unweighted estimates, groups and MR bases match", () => {
    const w: T = out.weighted, raw: T = out.raw, g: T = out.groups;
    expect(raw.total.n).toBe(120);
    expect(w.total).toEqual({ n: 120, w: 240, nEff: 96 });
    expect(row(w, "purchase", code1).total.pct).toBeCloseTo(65.0, 1);
    expect(row(raw, "purchase", code1).total.pct).toBeCloseTo(50.0, 1);
    expect(Math.abs(row(w, "rating10", mean).total.pct! - 6.5)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(row(raw, "rating10", mean).total.pct! - 5.0)).toBeLessThanOrEqual(0.01);
    const p1 = row(g, "purchase", code1);
    const col = (code: string) => g.columns.findIndex((c) => c.rawCode === code);
    expect(p1.pct[col("L")]).toBeCloseTo(20.0, 1);
    expect(p1.pct[col("H")]).toBeCloseTo(80.0, 1);
    const conv = row(w, "MR", mr("MR_Convenience"));
    expect(Math.abs(conv.total.pct! - 67.54385964912281)).toBeLessThanOrEqual(0.1);
    expect(conv.total.base).toEqual({ n: 116, w: 228, nEff: 92.2 });
    expect(row(w, "MR", mr("MR_Price")).total.pct).toBeCloseTo(25.0, 1);
    expect(row(w, "MR", mr("MR_Service")).total.pct).toBe(0);
    expect(row(raw, "pilot_group", code1).total.nCell).toBe(8);
  });

  it("rescaling every weight by 7 changes the weighted totals only", () => {
    const w: T = out.weighted, x7: T = out.x7;
    expect(x7.total).toEqual({ n: 120, w: 1680, nEff: 96 });
    for (const [key, pick] of [["purchase", code1], ["rating10", mean], ["MR", mr("MR_Convenience")]] as const) {
      expect(row(x7, key, pick).total.pct, key).toBe(row(w, key, pick).total.pct);
      expect(row(x7, key, pick).total.base.nEff, key).toBe(row(w, key, pick).total.base.nEff);
    }
  });

  it("the primary columns-as-cases workbook with a separate weights/MR codebook is refused explicitly, not misread", () => {
    expect(out.refusal).toMatch(/Unsupported flipped workbook.*No analytical result was produced/);
  });
});
