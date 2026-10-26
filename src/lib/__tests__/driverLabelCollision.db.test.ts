// AN500-F01 (Codex, 2026-10-24): canonical predictors X1, X2, X3 labelled "Service", "Service",
// "Service (X2)" became "Service", "Service (X2)", "Service (X2)" in the driver report. The chart
// joined each ranked driver to its performance by that name, so X3 (the strongest driver, mean 106)
// was plotted at X2's mean of 16, and the posted findings and their Excel export named "Service (X2)"
// as both the strongest and the third strongest driver.
//
// These run the actual driver actions (runDriverAnalysisFor with the real engine, save, reopen, post)
// and the actual Findings Excel route against a real disposable PostgreSQL. Only the statistics-file
// transport (runStatsTool, which reads the stored SAV through Python) is replaced: it returns the
// columns Python's driver_columns gives for this fixture, with labels exactly as Codex's SAV carried.
// Codex confirmed the Python reader keeps all three identities, so the boundary is not the defect.
//   fixture      the exact three-label collision: unique names, X3's row joins to mean 106
//   reorder      the same predictors in another order give the same code-to-mean association
//   saved        a saved and reopened analysis keeps the codes and the same joins
//   posted       posted findings carry the predictor's code; the Excel export names X3 and X2 apart
//   control      distinct labels are unchanged
//   legacy       an old saved report with colliding names and no codes is refused for posting
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { DriverReport, DriverRequest } from "../drivers";
import { recordForRow } from "../driverPresentation";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

/** Seeded fixture: X1 about 6, X2 about 16, X3 about 106; Y moves mostly with X3, least with X2. */
const N = 240;
const DATA = (() => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: N }, () => {
    const X1 = 6 + Math.round((rand() - 0.5) * 6);
    const X2 = 16 + Math.round((rand() - 0.5) * 6);
    const X3 = 106 + Math.round((rand() - 0.5) * 20);
    const Y = 1 + 0.3 * X1 + 0.05 * X2 + 0.5 * X3 + (rand() - 0.5) * 3;
    return { X1, X2, X3, Y } as Record<string, number>;
  });
})();
const LABELS: Record<string, Record<string, string>> = {
  collision: { X1: "Service", X2: "Service", X3: "Service (X2)" },
  distinct: { X1: "Speed", X2: "Price", X3: "Quality" },
};
const MEANS = Object.fromEntries(["X1", "X2", "X3"].map((v) => [v, DATA.reduce((a, r) => a + r[v], 0) / N]));
let labels = LABELS.collision;

vi.mock("../parseStatsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parseStatsFile")>()),
  runStatsTool: vi.fn(async (tool: string, _path: string, _file: string, args: { outcome: string; predictors: string[] }) => {
    if (tool !== "columns") throw new Error(`unexpected stats tool ${tool}`);
    const meta = (v: string) => {
      const vals = DATA.map((r) => r[v]);
      return { name: v, label: labels[v] ?? v, min: Math.min(...vals), max: Math.max(...vals), distinct: new Set(vals).size };
    };
    return {
      outcome: { ...meta(args.outcome), label: "Satisfaction", valueLabels: {} },
      predictors: args.predictors.map(meta),
      y: DATA.map((r) => r[args.outcome]),
      x: DATA.map((r) => args.predictors.map((v) => r[v])),
      weights: null,
      n: N,
      skipped: [],
      group: null,
      groupValues: null,
    };
  }),
}));
vi.setConfig({ testTimeout: 60000 });

const request = (predictors: string[]): DriverRequest => ({
  outcome: "Y",
  outcomeType: "continuous",
  topBoxMin: null,
  predictors,
  weightVar: null,
  statedImportance: {},
  groupVar: null,
  bootstrap: 0,
});

describe.skipIf(!TEST_DATABASE_URL)("AN500-F01 driver label collisions keep predictor identity (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let doc = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0];
  const actions = async () => await import("../driverActions");

  async function analyse(predictors: string[]): Promise<DriverReport> {
    const { runDriverAnalysisAction } = await actions();
    const r = await runDriverAnalysisAction(run, doc, request(predictors));
    if (!r.ok) throw new Error(r.error);
    return r.report;
  }
  /** Each ranked row's code and the mean the chart would plot for it, joined as the chart joins. */
  const plotted = (rep: DriverReport) =>
    Object.fromEntries(rep.result.rows.map((row) => [row.variable, recordForRow(row, rep.performance, rep.result.rows)?.mean ?? null]));

  async function excelRows(): Promise<string[]> {
    const { GET } = await import("../../app/api/runs/[id]/findings/export/route");
    const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    return wb.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1 }).map((r) => r.join(" | ")));
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic driver labels')", [tenant]);
    run = (await one("insert into runs(tenant_id,project_name,entry_point) values($1,'Driver labels','generate') returning id", [tenant])).id;
    doc = (await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report','labels.sav',$3) returning id", [tenant, run, `${tenant}/${run}/labels.sav`])).id;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("the exact fixture: three unique names, and X3 (strongest) is plotted at its own mean, not X2's", async () => {
    labels = LABELS.collision;
    const rep = await analyse(["X1", "X2", "X3"]);
    const names = rep.result.rows.map((r) => r.name);
    expect(new Set(names).size).toBe(3);
    expect(rep.result.rows.map((r) => r.variable).sort()).toEqual(["X1", "X2", "X3"]);
    expect(rep.result.rows[0].variable).toBe("X3");
    expect(rep.performance.map((p) => p.variable)).toEqual(["X1", "X2", "X3"]);
    const mean = plotted(rep);
    expect(mean.X3).toBeCloseTo(MEANS.X3, 10);
    expect(mean.X2).toBeCloseTo(MEANS.X2, 10);
    expect(mean.X1).toBeCloseTo(MEANS.X1, 10);
    expect(Math.abs(mean.X3! - 106)).toBeLessThan(3);
    // The display name X3 has is its own label; the result row named "Service (X2)" is X3.
    expect(rep.result.rows.find((r) => r.name === "Service (X2)")?.variable).toBe("X3");
  });

  it("reordered predictors keep the same code-to-mean association", async () => {
    labels = LABELS.collision;
    const a = plotted(await analyse(["X1", "X2", "X3"]));
    const b = plotted(await analyse(["X3", "X2", "X1"]));
    for (const v of ["X1", "X2", "X3"]) expect(b[v]).toBeCloseTo(a[v]!, 10);
  });

  it("distinct labels are unchanged and join the same way", async () => {
    labels = LABELS.distinct;
    const rep = await analyse(["X1", "X2", "X3"]);
    expect(rep.result.rows.map((r) => r.name).sort()).toEqual(["Price", "Quality", "Speed"]);
    expect(plotted(rep).X3).toBeCloseTo(MEANS.X3, 10);
  });

  it("a saved and reopened analysis keeps the codes; posting carries them and Excel names each driver apart", async () => {
    labels = LABELS.collision;
    const { saveDriverAnalysisAction, listDriverAnalysesAction, addDriverFindingsAction } = await actions();
    const rep = await analyse(["X1", "X2", "X3"]);
    const saved = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", rep);
    if (!saved.ok) throw new Error(saved.error);
    const list = await listDriverAnalysesAction(run, doc);
    if (!list.ok) throw new Error(list.error);
    const reopened = list.items.find((x) => x.id === saved.id)!.report;
    expect(plotted(reopened)).toEqual(plotted(rep));

    const added = await addDriverFindingsAction(run, saved.id);
    if (!added.ok) throw new Error(added.error);
    const stats = (await db.pool.query("select stated_stats from findings where run_id=$1 and stated_stats->>'analysisId'=$2 and stated_stats->>'kind'='driver'", [run, saved.id])).rows.map((r) => r.stated_stats);
    expect(stats.map((s) => s.variable).sort()).toEqual(["X1", "X2", "X3"]);
    const byVar = Object.fromEntries(stats.map((s) => [s.variable, s.question]));
    expect(new Set(Object.values(byVar)).size).toBe(3);
    expect(byVar.X3).toBe("Service (X2)");

    const rows = await excelRows();
    const strongest = rows.filter((r) => / is the strongest of 3 questions/.test(r));
    const third = rows.filter((r) => / is the third strongest of 3 questions/.test(r));
    expect(strongest).toHaveLength(1);
    expect(third).toHaveLength(1);
    expect(strongest[0]).toContain(`${byVar.X3} is the strongest`);
    expect(third[0]).toContain(`${byVar.X2} is the third strongest`);
    expect(byVar.X2).not.toBe(byVar.X3);
  });

  it("an old saved report with colliding names and no codes is refused for posting; nothing is added", async () => {
    labels = LABELS.collision;
    const { saveDriverAnalysisAction, addDriverFindingsAction } = await actions();
    const fresh = await analyse(["X1", "X2"]);
    // As saved before AN500-F01: no codes, and two rows under one name.
    const old: DriverReport = {
      ...fresh,
      result: { ...fresh.result, rows: fresh.result.rows.map((r) => ({ ...r, name: "Service (X2)", variable: undefined })) },
      performance: fresh.performance.map((p) => ({ ...p, name: "Service (X2)", variable: undefined })),
    };
    const saved = await saveDriverAnalysisAction(run, doc, "Old drivers", old);
    if (!saved.ok) throw new Error(saved.error);
    const added = await addDriverFindingsAction(run, saved.id);
    expect(added.ok).toBe(false);
    if (!added.ok) expect(added.error).toMatch(/share a name/);
    const n = (await one("select count(*)::int as n from findings where run_id=$1 and stated_stats->>'analysisId'=$2", [run, saved.id])).n;
    expect(n).toBe(0);
    // The chart joins nothing for those rows rather than guessing.
    expect(old.result.rows.map((row) => recordForRow(row, old.performance, old.result.rows))).toEqual([null, null]);
  });
});
