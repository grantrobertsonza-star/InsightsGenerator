// GT1000-F01 (Codex, 2026-10-21): driver findings were inserted without source_document_id, so
// deleting their data file cascaded to the saved analysis and left the findings, and an accepted
// insight on them, reading "Support current" in Excel and in the Accepted deck. These run the actual
// driver actions, deleteDocument, the support loaders and the export routes against a real
// disposable PostgreSQL. The driver result itself is computed by the real engine on synthetic data;
// only Next's request plumbing and storage (the deletion's file cleanup) are stubbed.
//   post          findings name the data file and carry the corrections the result was calculated with
//   delete        deleting the file removes the findings; the insight is no longer valid, in Excel
//                 and in the Accepted deck; an ordinary finding on the same file behaves the same way
//   unaffected    another file's analysis and its insight stay current
//   remove/add    rejection makes the insight invalid; adding again restores the same findings
//   corrections   a correction to a variable the analysis read is changed support; to another, not
//   legacy        a finding posted before provenance (no source id) resolves through its saved
//                 analysis (not checked, never current), is removed with its file, and reads no
//                 longer valid once its saved analysis is gone
//   concurrency   two simultaneous posts make one set of findings
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { driverAnalysis } from "../driverAnalysis";
import type { DriverReport, DriverRequest } from "../drivers";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: { storage: { from: () => ({ remove: vi.fn(async () => ({ error: null })), download: vi.fn(async () => ({ data: null, error: { message: "synthetic: no stored file" } })), upload: vi.fn() }) } },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("GT1000-F01 driver finding provenance (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0];
  const actions = async () => await import("../driverActions");

  async function dataFile(name: string): Promise<string> {
    return (await one("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report',$3,$4) returning id", [tenant, run, name, `${tenant}/${run}/${name}`])).id;
  }

  /** A real engine result, with the provenance runDriverAnalysisFor records (corrections now in effect). */
  async function report(documentId: string, predictors = ["X1", "X2"], provenance = true): Promise<DriverReport> {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = Array.from({ length: 120 }, () => {
      const x = predictors.map(() => Math.round(rand() * 10));
      return { x, y: 2 + 0.6 * x[0] + 0.2 * (x[1] ?? 0) + rand() * 2 };
    });
    const result = driverAnalysis({ y: rows.map((r) => r.y), x: rows.map((r) => r.x), names: predictors, outcome: "continuous", bootstrap: 20, seed: 1 });
    if ("error" in result) throw new Error(result.error);
    const request: DriverRequest = { outcome: "Y", outcomeType: "continuous", topBoxMin: null, predictors, weightVar: null, statedImportance: {}, groupVar: null };
    const { loadVariableOverrides } = await import("../variableOverrides");
    return {
      request,
      ...(provenance ? { provenance: { documentId, overridesSnapshot: await loadVariableOverrides(tenant, run, documentId), variables: ["Y", ...predictors] } } : {}),
      outcomeLabel: "Satisfaction",
      outcomeNote: "",
      casesInFile: 120,
      weighted: false,
      skipped: [],
      result,
      performance: [],
    };
  }

  /** Saves and posts an analysis; returns its id and its findings. */
  async function posted(documentId: string, title: string, rep?: DriverReport) {
    const { saveDriverAnalysisAction, addDriverFindingsAction } = await actions();
    const saved = await saveDriverAnalysisAction(run, documentId, title, rep ?? (await report(documentId)));
    if (!saved.ok) throw new Error(saved.error);
    const added = await addDriverFindingsAction(run, saved.id);
    if (!added.ok) throw new Error(added.error);
    const findings = (await db.pool.query("select id, source_document_id, stated_stats from findings where run_id=$1 and stated_stats->>'analysisId'=$2 order by created_at, id", [run, saved.id])).rows;
    return { id: saved.id, findings };
  }

  /** An accepted synthesized insight resting on one finding, with the support snapshot recorded now. */
  async function insightOn(findingId: string, headline: string) {
    const pre = (await one("insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication, support_snapshot) values ($1,$2,$3,'h','o','t','i', finding_support_parts($3)) returning id", [tenant, run, findingId])).id;
    const si = (await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
       values ($1,$2,$3,'o','t','i',1,1,1,'exploratory','accepted') returning id`,
      [tenant, run, headline],
    )).id;
    await db.pool.query("insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1,$2,$3, finding_support_parts($4))", [tenant, si, pre, findingId]);
    return { pre, si };
  }

  async function support(si: string) {
    const { loadInsightSupportOrUnchecked } = await import("../supportStatus");
    return (await loadInsightSupportOrUnchecked(tenant, run, [si])).statusOf(si);
  }
  async function preSupport(pre: string) {
    const { loadPreInsightSupportOrUnchecked } = await import("../supportStatus");
    return (await loadPreInsightSupportOrUnchecked(tenant, run, [pre])).statusOf(pre);
  }
  async function zipText(res: Response) {
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => n.endsWith(".xml"));
    return (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("\n").replace(/<[^>]+>/g, " ");
  }
  async function excelText() {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export/route");
    return zipText(await GET(new Request("http://x/?scope=all"), { params: Promise.resolve({ id: run }) }));
  }
  async function acceptedDeckText() {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export-deck/route");
    return zipText(await GET(new Request("http://x/?scope=accepted"), { params: Promise.resolve({ id: run }) }));
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic driver provenance')", [tenant]);
    run = (await one("insert into runs(tenant_id,project_name,entry_point) values($1,'Drivers','generate') returning id", [tenant])).id;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("posted driver findings name their data file and the corrections their result was calculated with", async () => {
    const doc = await dataFile("provenance.sav");
    const p = await posted(doc, "Drivers of Satisfaction");
    expect(p.findings.length).toBeGreaterThan(0);
    for (const f of p.findings) {
      expect(f.source_document_id).toBe(doc);
      expect(f.stated_stats.provenance).toEqual({ documentId: doc, overridesSnapshot: {}, variables: ["Y", "X1", "X2"] });
    }
    const { si, pre } = await insightOn(p.findings[0].id, "Driver provenance probe");
    expect((await support(si)).status).toBe("current");
    expect((await preSupport(pre)).status).toBe("current");
  });

  it("deleting the data file removes the driver findings: the insight is no longer valid in Excel and left out of the Accepted deck; another file's analysis stays current", async () => {
    const doc = await dataFile("deleted.sav");
    const kept = await dataFile("kept.sav");
    const gone = await posted(doc, "Drivers on the deleted file");
    const stays = await posted(kept, "Drivers on the kept file");
    const deleted = await insightOn(gone.findings[0].id, "Driver deletion probe");
    const unaffected = await insightOn(stays.findings[0].id, "Driver unaffected probe");
    // The ordinary control Codex used: a finding linked to the same file.
    const ordinary = (await one("insert into findings (tenant_id, run_id, origin, finding_text, status, theme, source_document_id, data_type) values ($1,$2,'generated','Ordinary finding on the deleted file','accepted','T',$3,'quantitative') returning id", [tenant, run, doc])).id;
    const ordinaryInsight = await insightOn(ordinary, "Ordinary deletion control");
    expect((await support(deleted.si)).status).toBe("current");

    const { deleteDocument } = await import("../documentActions");
    await deleteDocument(run, doc);

    expect(Number((await one("select count(*) as n from findings where stated_stats->>'analysisId'=$1", [gone.id])).n)).toBe(0);
    // Batch 25: the analysis moves to the bin with its file (restorable), so it is out of this project.
    expect(Number((await one("select count(*) as n from driver_analyses where id=$1 and run_id=$2", [gone.id, run])).n)).toBe(0);
    const after = await support(deleted.si);
    expect(after.status).toBe("invalid");
    expect((await support(ordinaryInsight.si)).status).toBe("invalid");
    expect((await support(unaffected.si)).status).toBe("current");
    const excel = await excelText();
    expect(excel).toMatch(/Support no longer valid/);
    const deck = await acceptedDeckText();
    expect(deck).toMatch(/Left out: support no longer valid/);
    expect(deck).toMatch(/Driver unaffected probe/);
    // A post of the deleted analysis is refused rather than recreating findings.
    const { addDriverFindingsAction } = await actions();
    expect((await addDriverFindingsAction(run, gone.id)).ok).toBe(false);
  });

  it("removing the findings makes the insight invalid; adding them again restores the same findings, current", async () => {
    const doc = await dataFile("toggle.sav");
    const p = await posted(doc, "Drivers toggled");
    const { si } = await insightOn(p.findings[0].id, "Driver toggle probe");
    const { removeDriverFindingsAction, addDriverFindingsAction } = await actions();
    expect((await removeDriverFindingsAction(run, p.id)).ok).toBe(true);
    expect((await support(si)).status).toBe("invalid");
    const again = await addDriverFindingsAction(run, p.id);
    expect(again.ok && again.added).toBe(p.findings.length);
    const ids = (await db.pool.query("select id from findings where stated_stats->>'analysisId'=$1 and status<>'rejected' order by created_at, id", [p.id])).rows.map((r) => r.id);
    expect(ids).toEqual(p.findings.map((f) => f.id));
    expect((await support(si)).status).toBe("current");
  });

  it("a correction to a variable the analysis read is changed support; a correction to another variable is not", async () => {
    const doc = await dataFile("corrections.sav");
    const p = await posted(doc, "Drivers corrected");
    const { si } = await insightOn(p.findings[0].id, "Driver corrections probe");
    await db.pool.query(`update documents set variable_overrides = '{"OTHER":{"label":"Unrelated"}}'::jsonb where id=$1`, [doc]);
    expect((await support(si)).status).toBe("current");
    await db.pool.query(`update documents set variable_overrides = '{"OTHER":{"label":"Unrelated"},"X1":{"label":"Corrected X1"}}'::jsonb where id=$1`, [doc]);
    const s = await support(si);
    expect(s.status).toBe("stale");
    expect(s.reasons.map((r) => r.kind)).toContain("corrections_changed");
  });

  it("a result without recorded corrections is not checked, never current", async () => {
    const doc = await dataFile("unrecorded.sav");
    const p = await posted(doc, "Drivers unrecorded", await report(doc, ["X1", "X2"], false));
    expect(p.findings[0].source_document_id).toBe(doc);
    const { si } = await insightOn(p.findings[0].id, "Driver unrecorded probe");
    const s = await support(si);
    expect(s.status).toBe("unknown");
    expect(s.reasons.map((r) => r.detail ?? "")).toContain("the variable corrections this driver analysis was calculated with were not recorded");
  });

  it("legacy findings (no source id) resolve through their saved analysis, are removed with their file, and are no longer valid once the analysis is gone", async () => {
    const doc = await dataFile("legacy.sav");
    const p = await posted(doc, "Drivers legacy");
    // The shape posted before GT1000-F01: no source_document_id, no provenance.
    await db.pool.query("update findings set source_document_id = null, stated_stats = stated_stats - 'provenance' where stated_stats->>'analysisId'=$1", [p.id]);
    const legacy = await insightOn(p.findings[0].id, "Legacy driver probe");
    const s = await support(legacy.si);
    expect(s.status).toBe("unknown");

    // Its saved analysis deleted (the file kept): no longer valid, with the reason.
    const doc2 = await dataFile("legacy-two.sav");
    const p2 = await posted(doc2, "Drivers legacy two");
    await db.pool.query("update findings set source_document_id = null, stated_stats = stated_stats - 'provenance' where stated_stats->>'analysisId'=$1", [p2.id]);
    const orphan = await insightOn(p2.findings[0].id, "Legacy orphan probe");
    const { deleteDriverAnalysisAction } = await actions();
    expect((await deleteDriverAnalysisAction(run, p2.id)).ok).toBe(true);
    const o = await support(orphan.si);
    expect(o.status).toBe("invalid");
    expect(o.reasons.some((r) => /saved driver analysis .* no longer exists/.test(r.detail ?? ""))).toBe(true);

    // Deleting the first legacy file reaches its findings through the saved analysis.
    const { loadDocumentDeletionImpact, impactFor } = await import("../documentDeletionImpact");
    expect(impactFor(await loadDocumentDeletionImpact(tenant, run), doc)?.findings).toBe(p.findings.length);
    const { deleteDocument } = await import("../documentActions");
    await deleteDocument(run, doc);
    expect(Number((await one("select count(*) as n from findings where stated_stats->>'analysisId'=$1", [p.id])).n)).toBe(0);
    expect((await support(legacy.si)).status).toBe("invalid");
  });

  it("a new finding whose saved analysis is deleted (its file kept) is no longer valid", async () => {
    const doc = await dataFile("analysis-deleted.sav");
    const p = await posted(doc, "Drivers whose analysis is deleted");
    const { si } = await insightOn(p.findings[0].id, "Analysis deleted probe");
    const { deleteDriverAnalysisAction } = await actions();
    expect((await deleteDriverAnalysisAction(run, p.id)).ok).toBe(true);
    expect((await support(si)).status).toBe("invalid");
  });

  it("two simultaneous posts of one analysis make one set of findings, each with its source", async () => {
    const doc = await dataFile("concurrent.sav");
    const { saveDriverAnalysisAction, addDriverFindingsAction } = await actions();
    const saved = await saveDriverAnalysisAction(run, doc, "Drivers concurrent", await report(doc));
    if (!saved.ok) throw new Error(saved.error);
    const [a, b] = await Promise.all([addDriverFindingsAction(run, saved.id), addDriverFindingsAction(run, saved.id)]);
    expect(a.ok && b.ok).toBe(true);
    const rows = (await db.pool.query("select source_document_id from findings where stated_stats->>'analysisId'=$1", [saved.id])).rows;
    expect(rows.length).toBe((a.ok ? a.added : 0) + (b.ok ? b.added : 0));
    expect(rows.every((r) => r.source_document_id === doc)).toBe(true);
  });

  it("a saved result whose provenance names another file is refused", async () => {
    const doc = await dataFile("mismatch.sav");
    const other = await dataFile("mismatch-other.sav");
    const { saveDriverAnalysisAction } = await actions();
    const r = await saveDriverAnalysisAction(run, doc, "Mismatched", await report(other));
    expect(r.ok).toBe(false);
    expect(Number((await one("select count(*) as n from driver_analyses where document_id=$1", [doc])).n)).toBe(0);
  });
});
