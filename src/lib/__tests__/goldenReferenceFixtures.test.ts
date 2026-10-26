import { PYTHON } from "./helpers/pythonEngine";
// Golden reference fixtures (permanent since 2026-10-17; first run as the deep golden-thread
// check's numbers layer). Every assertion in
// fixtures/golden-thread-1/expected.json that the engine can answer, checked against the ACTUAL
// Python engine (api/parse-stats-file.py dictionary() and crosstab()) and the app's own NPS
// function (descriptiveFindings.ts computeNps), within each assertion's own absolute tolerance.
// The expected values come from the fixture's independent reference (openpyxl + standard-library
// arithmetic, never application functions). Nothing is mocked.
// Method differences the fixture README allows are compared on conclusion and bounded magnitude,
// never waved through: the fixture's two-proportion z and p use a pooled null SE; the app's column
// test uses the unpooled SE (stated in its notes), so z must agree in conclusion at .05 and within
// 10%, and p in conclusion and within a factor of 2. Identifiers are compared as literal values
// (0001, 0200) as the engine reads them. A statistic with no rule fails. Negative controls prove
// each rule rejects a contradictory reference (Codex review 2026-10-17: z = 0, ID 9999 and an
// unsupported statistic used to pass).
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
# The identifiers as the engine itself reads them (its own reader), so leading zeros are checked
# on the values the app works with, not on a separate spreadsheet read.
df, _meta = eng._read(b, "golden.xlsx", selected_sheet="Data")
ids = [str(v) for v in df["RespondentID"].tolist()]
print(json.dumps({"dictionary": d, "total": tab([]), "byGender": tab(["Gender"]),
  "continuous": eng.crosstab(b, "golden.xlsx", {"selectedSheet": "Data", "columnVars": ["Gender"], "typeOverrides": {"Satisfaction": "continuous"}, "rowItems": [{"key": "Satisfaction", "label": "Satisfaction", "vars": ["Satisfaction"]}]}),
  "ids": {"first": ids[0], "last": ids[-1], "count": len(ids)}}, default=str))
`;

type Q = { key: string; rows: (CrosstabRow & { rawCode?: string | number })[]; desc?: { mean?: number }; tableTests?: { chi2: number; p: number }[] };
type Table = { questions: Q[]; columns: { var: string; rawCode: string }[]; selectedSheet?: string; notes: { test: string; correction?: string }; total: { n: number } };
type EngineOutput = { dictionary: { nCases: number }; total: Table; byGender: Table; continuous: Table; ids: { first: string; last: string; count: number } };
type Result = { id: string; observed: unknown; expected: unknown; ok: boolean; note?: string };

// Standard normal inverse CDF (Acklam's rational approximation; |error| < 1.2e-9), used to turn the
// engine's two-sided p back into |z| so a z reference can be compared on magnitude and conclusion.
function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const Z_CRIT = 1.959963984540054;

/**
 * Checks every reference assertion against the engine output. Each statistic has one rule; a
 * statistic with no rule FAILS (it is never counted as passed). Method differences the fixture
 * README allows (pooled reference vs the app's unpooled column test) are compared on conclusion at
 * .05 plus a bounded magnitude, never waved through.
 */
function evaluate(assertions: Assertion[], out: EngineOutput): Result[] {
  const q = (t: Table, key: string) => t.questions.find((x) => x.key === key)!;
  const answerRows = (x: Q) => x.rows.filter((row) => !(row as { isBase?: boolean }).isBase && !(row as { isMean?: boolean }).isMean);
  const columnIndex = (t: Table, seg: { variable: string; rawCode: string }) => t.columns.findIndex((c) => c.var === seg.variable && c.rawCode === seg.rawCode);
  const rowFor = (x: Q, code: string | number) => answerRows(x).find((row) => String(row.rawCode ?? row.label) === String(code));
  const mrLabel: Record<string, string> = { MR_Convenience: "Convenience", MR_Value: "Value", MR_Service: "Service" };
  const testedRow = (a: Assertion) =>
    a.canonicalVariable === "MR_Convenience" ? answerRows(q(out.byGender, "Reasons")).find((row) => row.label === "Convenience") : rowFor(q(out.byGender, a.canonicalVariable!), a.rawCategoryCodes[0]);
  const results: Result[] = [];
  const record = (a: Assertion, observed: unknown, ok: boolean, note?: string) => results.push({ id: a.id, observed, expected: a.expectedValue, ok, note });
  const near = (a: Assertion, v: number | null | undefined) => typeof v === "number" && typeof a.expectedValue === "number" && Math.abs(v - a.expectedValue) <= a.tolerance.value + 1e-9;

  for (const a of assertions) {
    const t = a.segment ? out.byGender : out.total;
    const col = a.segment ? columnIndex(out.byGender, a.segment) : -1;
    const pctOf = (row: CrosstabRow) => (col >= 0 ? row.pct[col] : row.total.pct);
    switch (a.statistic) {
      case "authoritative_sheet": {
        const v = out.total.selectedSheet; record(a, v, v === a.expectedValue && out.dictionary.nCases === a.base.expected); break;
      }
      case "identifier": {
        // The literal value at the position the assertion names, as the engine read it (text, so
        // leading zeros survive); an assertion naming no position cannot be checked and fails.
        const position = a.id.endsWith("-first") ? "first" : a.id.endsWith("-last") ? "last" : null;
        const v = position ? out.ids[position] : null;
        record(a, v, position !== null && v === a.expectedValue && out.ids.count === a.base.expected, position ? undefined : "identifier assertion names no position (first/last)");
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
        const ok = Array.isArray(v)
          ? Array.isArray(a.expectedValue) && v.length === 2 && v.every((x, i) => Math.abs(x - (a.expectedValue as number[])[i]) <= a.tolerance.value + 1e-9)
          : near(a, v as number | null);
        record(a, v, ok); break;
      }
      case "pearson_chi_square": { const v = q(out.byGender, a.canonicalVariable!).tableTests?.[0]?.chi2; record(a, v, near(a, v)); break; }
      case "significant_at_alpha_.05": {
        const x = testedRow(a);
        const significant = !!x && x.sig.some((s) => s !== 0);
        record(a, significant, typeof a.expectedValue === "boolean" && significant === a.expectedValue, "conclusion compared (method differs: unpooled column test)"); break;
      }
      case "pooled_two_proportion_z": {
        // |z| from the engine's p; the reference is pooled, the engine unpooled, so the conclusion at
        // .05 must agree and the magnitudes must be within 10% of each other.
        const p = testedRow(a)?.p?.[0] ?? null;
        const expected = typeof a.expectedValue === "number" ? Math.abs(a.expectedValue) : NaN;
        const zEngine = p === null ? NaN : p <= 0 ? Infinity : Math.abs(normInv(p / 2));
        const ok = Number.isFinite(expected) && Number.isFinite(zEngine) && (zEngine >= Z_CRIT) === (expected >= Z_CRIT) && Math.abs(zEngine - expected) <= 0.1 * expected;
        record(a, zEngine, ok, "unpooled |z| from the engine's p vs pooled reference: same conclusion, within 10%"); break;
      }
      case "two_sided_p": {
        // Same conclusion at .05, and within a factor of 2 (the documented SE-form difference).
        const p = testedRow(a)?.p?.[0] ?? null;
        const e = typeof a.expectedValue === "number" ? a.expectedValue : NaN;
        const ok = p !== null && Number.isFinite(e) && (p < 0.05) === (e < 0.05) && Math.abs(Math.log(Math.max(p, 1e-12) / Math.max(e, 1e-12))) <= Math.log(2);
        record(a, p, ok, "unpooled vs pooled p: same conclusion, within a factor of 2"); break;
      }
      default: record(a, null, false, `no rule for statistic "${a.statistic}": unsupported assertions fail`);
    }
  }
  return results;
}

describe.skipIf(!PYTHON_OK)("golden thread 1: engine numbers against the independent reference", () => {
  const r = spawnSync(PYTHON, ["-c", DRIVER, ENGINE, path.join(FIXTURE, "golden-survey-documented.xlsx")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  const out = JSON.parse(r.stdout) as EngineOutput;
  const failedIds = (assertions: Assertion[]) => evaluate(assertions, out).filter((x) => !x.ok).map((x) => x.id);
  const mutate = (id: string, change: Partial<Assertion>) => reference.assertions.map((a) => (a.id === id ? { ...a, ...change } : a));

  it("the table notes name the column test actually applied (unpooled standard errors, no correction)", () => {
    expect(out.byGender.notes.test).toMatch(/two-proportion z-test with unpooled standard errors on effective bases/);
    // The significance conclusions below are compared uncorrected, as the reference computes them.
    expect(out.byGender.notes.correction).toBe("none");
  });

  it("every canonical assertion matches within its tolerance (or, where the method differs, in conclusion and bounded magnitude)", () => {
    const results = evaluate(reference.assertions, out);
    console.log("GOLDEN_REFERENCE_RESULTS", JSON.stringify(results));
    expect(results.filter((x) => !x.ok)).toEqual([]);
    expect(results.length).toBe(reference.assertions.length);
  });

  // Negative controls: each broken reference must fail, and only on the assertion that was broken.
  it("negative control: a contradictory significance reference (z = 0 for a significant difference) fails", () => {
    expect(failedIds(mutate("Purchase-z", { expectedValue: 0 }))).toEqual(["Purchase-z"]);
  });
  it("negative control: a wrong identifier (9999 for the first respondent) fails", () => {
    expect(failedIds(mutate("id-first", { expectedValue: "9999" }))).toEqual(["id-first"]);
  });
  it("negative control: an unsupported assertion type fails rather than passing unchecked", () => {
    const unsupported = { ...reference.assertions[0], id: "unsupported-statistic", statistic: "harmonic_mean_of_bases" };
    expect(failedIds([...reference.assertions, unsupported])).toEqual(["unsupported-statistic"]);
  });
  it("negative controls: a contradictory p conclusion and a contradictory significance flag fail", () => {
    expect(failedIds(mutate("Purchase-p", { expectedValue: 0.5 }))).toEqual(["Purchase-p"]);
    expect(failedIds(mutate("NearTie-significant", { expectedValue: true }))).toEqual(["NearTie-significant"]);
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
