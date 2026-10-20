// IR-03 (Codex, 2026-10-20): a reopened driver analysis posted again made a second analysis and a
// second set of findings (3 became 6). These run the actual driver actions against a real database:
// saving the same result returns the analysis already saved, posting an analysis already in findings
// adds nothing and keeps researcher wording, simultaneous posts and saves make one artifact, and
// another project's analysis or data file is refused. The result itself is computed by the real
// driver engine on synthetic data; only Next's request plumbing is stubbed.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { driverAnalysis } from "../driverAnalysis";
import type { DriverReport, DriverRequest } from "../drivers";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
// The statistics file boundary (storage and the Python reader) is not reached by these actions; it
// is stubbed only so importing drivers.ts does not need storage credentials.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

/** A real engine result on a seeded synthetic sample: Y depends on X1 strongly, X2 a little, X3 not. */
function report(predictors: string[], shift = 0): DriverReport {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = Array.from({ length: 120 }, () => {
    const x = predictors.map(() => Math.round(rand() * 10));
    const y = 2 + 0.6 * x[0] + 0.2 * (x[1] ?? 0) + rand() * 2 + shift;
    return { x, y };
  });
  const result = driverAnalysis({ y: rows.map((r) => r.y), x: rows.map((r) => r.x), names: predictors, outcome: "continuous", bootstrap: 20, seed: 1 });
  if ("error" in result) throw new Error(result.error);
  const request: DriverRequest = { outcome: "Y", outcomeType: "continuous", topBoxMin: null, predictors, weightVar: null, statedImportance: {}, groupVar: null };
  return { request, outcomeLabel: "Satisfaction", outcomeNote: "", casesInFile: 120, weighted: false, skipped: [], result, performance: [] };
}

describe.skipIf(!TEST_DATABASE_URL)("driver analyses: one artifact per result, posted once (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string, doc: string, otherDoc: string;
  const a = async () => await import("../driverActions");
  const count = async (sql: string, params: unknown[]) => Number((await db.pool.query(sql, params)).rows[0].n);
  const analyses = () => count("select count(*) as n from driver_analyses where run_id = $1", [run]);
  const inUse = (id: string) => count("select count(*) as n from findings where run_id = $1 and pattern_type = 'driver' and stated_stats->>'analysisId' = $2 and status <> 'rejected'", [run, id]);
  const allDriverFindings = () => count("select count(*) as n from findings where run_id = $1 and pattern_type = 'driver'", [run]);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic drivers')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
    const mk = async (r: string) =>
      (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report','survey.sav',$3) returning id", [tenant, r, `${tenant}/${r}/survey.sav`])).rows[0].id as string;
    doc = await mk(run);
    otherDoc = await mk(other);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("saving the same result twice returns the same analysis; the saved request is the one the screen restores", async () => {
    const { saveDriverAnalysisAction, listDriverAnalysesAction } = await a();
    const rep = report(["X1", "X2", "X3"]);
    const first = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", rep);
    const again = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", rep);
    expect(first.ok && again.ok && first.id === again.id).toBe(true);
    expect(await analyses()).toBe(1);
    const list = await listDriverAnalysesAction(run, doc);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.items).toHaveLength(1);
    // What reopenSaved puts back in the controls: the full request, exactly as saved.
    expect(list.items[0].report.request).toEqual(rep.request);
  });

  it("posting an analysis already in findings adds nothing and keeps the researcher's wording; removing and posting again restores the same findings", async () => {
    const { saveDriverAnalysisAction, addDriverFindingsAction, removeDriverFindingsAction } = await a();
    const saved = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", report(["X1", "X2", "X3"]));
    if (!saved.ok) throw new Error(saved.error);
    const posted = await addDriverFindingsAction(run, saved.id);
    expect(posted).toMatchObject({ ok: true, alreadyPosted: 0 });
    const n = posted.ok ? posted.added : 0;
    expect(n).toBeGreaterThanOrEqual(3);
    const target = (await db.pool.query("select id from findings where run_id = $1 and stated_stats->>'analysisId' = $2 order by created_at limit 1", [run, saved.id])).rows[0].id;
    await db.pool.query("update findings set finding_text = 'Researcher wording kept' where id = $1", [target]);

    // The reopened analysis is posted again (IR-03's 3 -> 6): nothing is added.
    const repost = await addDriverFindingsAction(run, saved.id);
    expect(repost).toEqual({ ok: true, added: 0, alreadyPosted: n });
    expect(await inUse(saved.id)).toBe(n);
    expect(await allDriverFindings()).toBe(n);

    // Re-running the same request on the same data and posting saves no copy and adds nothing.
    const rerun = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", report(["X1", "X2", "X3"]));
    expect(rerun.ok && rerun.id).toBe(saved.id);
    expect(await addDriverFindingsAction(run, saved.id)).toEqual({ ok: true, added: 0, alreadyPosted: n });

    expect(await removeDriverFindingsAction(run, saved.id)).toEqual({ ok: true, removed: n });
    const back = await addDriverFindingsAction(run, saved.id);
    expect(back).toEqual({ ok: true, added: n, alreadyPosted: 0 });
    expect(await allDriverFindings()).toBe(n);
    expect((await db.pool.query("select finding_text from findings where id = $1", [target])).rows[0].finding_text).toBe("Researcher wording kept");
  });

  it("two simultaneous posts of one analysis make one set of findings; two simultaneous saves make one analysis", async () => {
    const { saveDriverAnalysisAction, addDriverFindingsAction } = await a();
    const rep = report(["X1", "X2"]);
    const before = await analyses();
    const [s1, s2] = await Promise.all([
      saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", rep),
      saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", rep),
    ]);
    expect(s1.ok && s2.ok && s1.id === s2.id).toBe(true);
    expect(await analyses()).toBe(before + 1);
    const id = s1.ok ? s1.id : "";
    const [p1, p2] = await Promise.all([addDriverFindingsAction(run, id), addDriverFindingsAction(run, id)]);
    expect(p1.ok && p2.ok).toBe(true);
    const added = (p1.ok ? p1.added : 0) + (p2.ok ? p2.added : 0);
    expect(added).toBe(await inUse(id));
    expect([p1.ok && p1.added, p2.ok && p2.added]).toContain(0);
  });

  it("a changed result for the same request is a new analysis, not an overwrite of the posted one", async () => {
    const { saveDriverAnalysisAction } = await a();
    const original = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", report(["X1", "X2", "X3"]));
    const changed = await saveDriverAnalysisAction(run, doc, "Drivers of Satisfaction", report(["X1", "X2", "X3"], 1.5));
    expect(original.ok && changed.ok && original.id !== changed.id).toBe(true);
  });

  it("another project's analysis or data file is refused, with nothing written", async () => {
    const { saveDriverAnalysisAction, addDriverFindingsAction } = await a();
    const theirs = await saveDriverAnalysisAction(other, otherDoc, "Theirs", report(["X1", "X2"]));
    if (!theirs.ok) throw new Error(theirs.error);
    const before = await allDriverFindings();
    expect(await addDriverFindingsAction(run, theirs.id)).toEqual({ ok: false, error: "That analysis was not found." });
    expect(await saveDriverAnalysisAction(run, otherDoc, "Wrong file", report(["X1", "X2"]))).toEqual({ ok: false, error: "That data file is not in this project." });
    expect(await allDriverFindings()).toBe(before);
    expect(await count("select count(*) as n from driver_analyses where run_id = $1 and document_id = $2", [run, otherDoc])).toBe(0);
  });
});
