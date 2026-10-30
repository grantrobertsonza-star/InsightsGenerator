// Codex T2-F01 (independent T2 review, 30 October 2026): the driver performance measure was chosen from the answers
// present (observed minimum, maximum and number of codes), even when the engine knew a larger declared answer list.
// A declared 1 to 5 scale answered only 4 and 5 read as a mean with no top two; a declared 0 to 10 scale answered only
// 0 and 1 read as a 0/1 indicator (a 50% "share") instead of top two 0%. The same rule served the whole file and each
// segment. driverPerformance.ts now reads the measure from the engine's answer domain (declared substantive codes
// together with the observed answers; non-answers left out by the answer-domain owner), with the observed answers as
// an explicitly identified fallback when the file has no answer list.
//
// These run the actual runDriverAnalysisFor with the actual Python engine (local runner) on SPSS files written by
// pyreadstat with complete answer lists. Only the external boundaries are stubbed: storage (an in-memory map), the
// saved data layout, the document row, label overlay and corrections (no database is needed for a calculation that
// is not saved). Expected figures are written out here from the generated cases, never read from the app.
//   sparse       declared 1-5 answered 4/5: top two 100%; declared 0-10 answered 0/1: top two 0%; a genuine 0/1
//                indicator stays a share; a declared 1-5 with a "Don't know" (9) answered 4/5/9: 9 is never the top
//   endpoints    a 0-10 scale whose list labels only 0 and 10, answered 0/1: still an eleven-point scale
//   observed     a predictor with no answer list answered 4/5: a mean, the fallback said (domainSource "observed")
//   weighted     weighted figures for the whole file and for each segment, hand-computed
//   restored     the same questions once the unused answers appear: same measure and scale, figures from the counts;
//                the unlabelled predictor becomes a top two, still said to be observed
//   stated       a declared 1-5 importance question answered 1 to 3: top two 0%, by the same rule
//   axis         sparse and full declared 1-5 predictors share one performance axis ("same")
//   Codex's own Python fixture generator and SPSS files are not reused; these are generated here the same way.
// Skipped, with the reason, without python3 + pandas/pyreadstat.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PYTHON } from "./helpers/pythonEngine";
import type { DriverPerformance, DriverReport, DriverRequest } from "../drivers";

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), current: "" }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));
vi.mock("../dataSetup", () => ({ loadDataSetupWithStatus: async () => ({ ok: true, setup: { layout: "rows_are_cases", headerRowsSkipped: null } }) }));
vi.mock("../crosstabs", () => ({
  loadDocumentFile: async () => ({ storage_path: storage.current, source_filename: "drivers.sav", selected_sheet: null }),
  overlayFor: async () => null,
}));
vi.mock("../variableOverrides", () => ({ loadVariableOverrides: async () => ({}) }));
vi.mock("../findingProvenance", () => ({ recordHumanReview: vi.fn() }));
vi.mock("../db", () => ({ withTenant: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

/** A .sav written by pyreadstat; value labels per column. */
function sav(columns: Record<string, number[]>, labels: Record<string, Record<number, string>>): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "driver-domain-"));
  const out = path.join(dir, "data.sav");
  const script = String.raw`
import json, sys, pandas as pd, pyreadstat
spec = json.loads(sys.argv[1])
df = pd.DataFrame({k: pd.Series(v, dtype="float64") for k, v in spec["columns"].items()})
labels = {k: {float(c): t for c, t in v.items()} for k, v in spec["labels"].items()}
pyreadstat.write_sav(df, sys.argv[2], variable_value_labels=labels)
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, JSON.stringify({ columns, labels }), out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`pyreadstat could not write the fixture: ${r.stderr || r.stdout || `exit ${r.status}`}`);
  return readFileSync(out);
}

const FIVE = { 1: "Very poor", 2: "Poor", 3: "Fair", 4: "Good", 5: "Very good" };
const ELEVEN = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i, i === 0 ? "Not at all likely" : i === 10 ? "Extremely likely" : String(i)]));

/** 80 cases, two groups of 40 (G 1 and 2), weights 1 and 3; sparse or full answers as asked. */
function cases(full: boolean) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (codes: number[]) => codes[Math.floor(rand() * codes.length)];
  const rows = Array.from({ length: 80 }, (_, i) => {
    const P5 = full ? pick([1, 2, 3, 4, 5]) : pick([4, 5]);
    const P10 = full ? pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) : pick([0, 1]);
    const END = full ? pick([0, 3, 5, 9, 10]) : pick([0, 1]);
    const IND = pick([0, 1]);
    const DK = i % 10 === 0 ? 9 : full ? pick([1, 2, 3, 4, 5]) : pick([4, 5]);
    const PU = full ? pick([1, 2, 3, 4, 5]) : pick([4, 5]);
    const IMP = full ? pick([1, 2, 3, 4, 5]) : pick([1, 2, 3]);
    const Y = 1 + 0.4 * P5 + 0.2 * P10 + 0.3 * IND + 0.1 * END + 0.2 * PU + rand() * 2;
    // A declared 1-5 outcome; the sparse file never uses its top answer (5). Drawn last so the other columns are unchanged.
    const OUT = full ? pick([1, 2, 3, 4, 5]) : pick([1, 2, 3, 4]);
    return { Y, P5, P10, END, IND, DK, PU, IMP, OUT, G: i < 40 ? 1 : 2, W: i % 3 === 0 ? 3 : 1 };
  });
  const col = (k: keyof (typeof rows)[number]) => rows.map((r) => r[k]);
  const columns = { Y: col("Y"), P5: col("P5"), P10: col("P10"), END: col("END"), IND: col("IND"), DK: col("DK"), PU: col("PU"), IMP: col("IMP"), OUT: col("OUT"), G: col("G"), W: col("W") };
  const labels = { P5: FIVE, P10: ELEVEN, END: { 0: "Not at all likely", 10: "Extremely likely" }, IND: { 0: "No", 1: "Yes" }, DK: { ...FIVE, 9: "Don't know" }, IMP: FIVE, OUT: FIVE, G: { 1: "Men", 2: "Women" } };
  return { rows, columns, labels };
}

const PREDICTORS = ["P5", "P10", "END", "IND", "DK", "PU"] as const;
type Row = ReturnType<typeof cases>["rows"][number];

/** Hand-written expectation: (weighted) mean and share at or above `from`, over answered cases (9 = Don't know out). */
function expected(rows: Row[], v: (typeof PREDICTORS)[number] | "IMP", weighted: boolean, from: number | null) {
  const used = rows.filter((r) => !(v === "DK" && r.DK === 9));
  const w = (r: Row) => (weighted ? r.W : 1);
  const sw = used.reduce((a, r) => a + w(r), 0);
  return {
    mean: used.reduce((a, r) => a + r[v] * w(r), 0) / sw,
    top: from === null ? null : used.reduce((a, r) => a + (r[v] >= from ? w(r) : 0), 0) / sw,
  };
}

const request = (weighted: boolean, group: boolean): DriverRequest => ({
  outcome: "Y",
  outcomeType: "continuous",
  predictors: [...PREDICTORS],
  weightVar: weighted ? "W" : null,
  groupVar: group ? "G" : null,
  bootstrap: 0,
  statedImportance: { P5: "IMP" },
});

async function analyse(file: ReturnType<typeof cases>, weighted: boolean, group: boolean): Promise<DriverReport> {
  // A new storage path per file, as a new upload has; the local runner caches a download by its path.
  storage.current = `t/r/${randomUUID()}/drivers.sav`;
  storage.objects.set(storage.current, sav(file.columns, file.labels));
  const { runDriverAnalysisFor } = await import("../drivers");
  return runDriverAnalysisFor("tenant", "run", "doc", request(weighted, group));
}
const by = (perf: DriverPerformance[] | undefined, v: string) => {
  const p = perf?.find((x) => x.variable === v);
  if (!p) throw new Error(`no performance for ${v}`);
  return p;
};

describe.skipIf(!PYTHON_OK)("driver performance from the declared answer domain (Codex T2-F01; actual engine)", () => {
  const sparse = cases(false);
  const full = cases(true);
  let sparseReport: DriverReport;
  let fullReport: DriverReport;
  beforeAll(async () => {
    delete process.env.VERCEL_URL;
    delete process.env.PARSE_STATS_FILE_URL;
    sparseReport = await analyse(sparse, true, true);
    fullReport = await analyse(full, true, true);
  });

  it("sparse: declared 1-5 answered 4/5 is top two 100%; declared 0-10 answered 0/1 is top two 0%; a 0/1 indicator is a share", () => {
    expect(by(sparseReport.performance, "P5")).toMatchObject({ measure: "topTwo", topTwo: 1, scaleTop: 5, scaleMin: 1, domainSource: "declared" });
    const p10 = by(sparseReport.performance, "P10");
    expect(p10).toMatchObject({ measure: "topTwo", topTwo: 0, scaleTop: 10, scaleMin: 0, domainSource: "declared" });
    expect(p10.mean).toBeCloseTo(expected(sparse.rows, "P10", true, null).mean, 10);
    const ind = by(sparseReport.performance, "IND");
    expect(ind).toMatchObject({ measure: "share", topTwo: null, domainSource: "declared" });
    expect(ind.mean).toBeCloseTo(expected(sparse.rows, "IND", true, null).mean, 10);
  });

  it("sparse: a declared Don't know (9) is never the top of the scale; answered 4/5 is top two 100%", () => {
    expect(by(sparseReport.performance, "DK")).toMatchObject({ measure: "topTwo", topTwo: 1, scaleTop: 5, scaleMin: 1, domainSource: "declared" });
  });

  it("endpoints: a 0-10 list labelling only 0 and 10, answered 0/1, is still an eleven-point scale", () => {
    expect(by(sparseReport.performance, "END")).toMatchObject({ measure: "topTwo", topTwo: 0, scaleTop: 10, scaleMin: 0, domainSource: "declared" });
  });

  it("observed: with no answer list the answers present decide, and the fallback is said", () => {
    const pu = by(sparseReport.performance, "PU");
    expect(pu).toMatchObject({ measure: "mean", topTwo: null, domainSource: "observed" });
    expect(pu.mean).toBeCloseTo(expected(sparse.rows, "PU", true, null).mean, 10);
  });

  it("weighted, whole file and each segment: hand-computed from the cases", () => {
    for (const [v, from] of [["P5", 4], ["P10", 9], ["DK", 4]] as const) {
      const e = expected(full.rows, v, true, from);
      expect(by(fullReport.performance, v).topTwo).toBeCloseTo(e.top!, 10);
      expect(by(fullReport.performance, v).mean).toBeCloseTo(e.mean, 10);
    }
    expect(fullReport.segments?.map((s) => s.name)).toEqual(["Men", "Women"]);
    for (const [k, seg] of (fullReport.segments ?? []).entries()) {
      const rows = full.rows.filter((r) => r.G === k + 1);
      for (const [v, from] of [["P5", 4], ["P10", 9]] as const) {
        expect(by(seg.performance, v).topTwo).toBeCloseTo(expected(rows, v, true, from).top!, 10);
      }
      expect(by(seg.performance, "IND").mean).toBeCloseTo(expected(rows, "IND", true, null).mean, 10);
    }
    // Sparse segments keep the file's declared scale: each segment's 0-10 answers (0/1) are top two 0%, never a share.
    for (const seg of sparseReport.segments ?? []) {
      expect(by(seg.performance, "P10")).toMatchObject({ measure: "topTwo", topTwo: 0, scaleTop: 10 });
      expect(by(seg.performance, "P5")).toMatchObject({ measure: "topTwo", topTwo: 1, scaleTop: 5 });
    }
    expect(sparseReport.segments).toHaveLength(2);
  });

  it("restored: once the unused answers appear, the declared questions keep their measure and scale", () => {
    for (const v of ["P5", "P10", "END", "IND", "DK"]) {
      const a = by(sparseReport.performance, v);
      const b = by(fullReport.performance, v);
      expect([b.measure, b.scaleTop, b.scaleMin, b.domainSource]).toEqual([a.measure, a.scaleTop, a.scaleMin, a.domainSource]);
    }
    // The unlabelled predictor's measure follows its answers, and says it was read from them.
    expect(by(fullReport.performance, "PU")).toMatchObject({ measure: "topTwo", scaleTop: 5, domainSource: "observed" });
    expect(by(fullReport.performance, "PU").topTwo).toBeCloseTo(expected(full.rows, "PU", true, 4).top!, 10);
  });

  it("stated importance: a declared 1-5 importance question answered 1 to 3 has top two 0%, by the same rule", () => {
    // Before, its top two was counted down from the highest answer present (2 and 3).
    const s = sparseReport.stated?.find((x) => x.variable === "IMP");
    expect(s?.topTwo).toBe(0);
    expect(s?.mean).toBeCloseTo(expected(sparse.rows, "IMP", true, null).mean, 10);
    const f = fullReport.stated?.find((x) => x.variable === "IMP");
    expect(f?.topTwo).toBeCloseTo(expected(full.rows, "IMP", true, 4).top!, 10);
  });

  it("unweighted: the same measures, with unweighted figures", async () => {
    const r = await analyse(full, false, false);
    expect(by(r.performance, "P10").topTwo).toBeCloseTo(expected(full.rows, "P10", false, 9).top!, 10);
    expect(r.segments).toBeNull();
  });

  it("binary outcome: the default top box comes from the declared answer list, not from the highest answer present", async () => {
    // Codex T2-F01's bug class in the outcome: a declared 1-5 outcome answered 1 to 4 had its top box counted down
    // from 4 (3 and 4); it is the scale's top two, 4 and 5. Without an answer list the answers present decide, said so.
    const { runDriverAnalysisFor } = await import("../drivers");
    const binary = (outcome: string): DriverRequest => ({ ...request(false, false), outcome, outcomeType: "binary", predictors: ["P5", "IND"], statedImportance: undefined });
    storage.current = `t/r/${randomUUID()}/drivers.sav`;
    storage.objects.set(storage.current, sav(sparse.columns, sparse.labels));
    const declared = await runDriverAnalysisFor("tenant", "run", "doc", binary("OUT"));
    expect(declared.outcomeNote).toContain("answers from 4 up to 5,");
    expect(declared.outcomeNote).not.toContain("no answer list");
    const observed = await runDriverAnalysisFor("tenant", "run", "doc", binary("PU"));
    expect(observed.outcomeNote).toContain("answers from 5 up to 5 (no answer list, so the scale is the answers present)");
    // A chosen top box is checked against the scale's lowest code (1), not the lowest answer present.
    await expect(runDriverAnalysisFor("tenant", "run", "doc", { ...binary("OUT"), topBoxMin: 1 })).rejects.toThrow("The top box must start above the lowest answer code.");
  });

  it("axis: sparse and full declared 1-5 predictors read on one axis", async () => {
    const { performanceScales } = await import("../driverPerformance");
    expect(performanceScales([by(sparseReport.performance, "P5") as never, by(fullReport.performance, "P5") as never])).toBe("same");
    expect(performanceScales([by(sparseReport.performance, "P5") as never, by(sparseReport.performance, "P10") as never])).toBe("mixed");
  });
});
