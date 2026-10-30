// SEC2: the ownership check at the entry of every server action that takes a run id, proven on a
// real disposable PostgreSQL through a role that bypasses row-level security.
//
// SEC1 (tenantScopingWithoutRls.db.test.ts) covered the writes action modules make themselves.
// Most actions instead pass the run id to a library function (crosstabs, codingMemos, drivers,
// objectiveEvidence and others), and some of those read or write by run id alone. SEC2 checks the
// run at the entry of each such action, so another organisation's project answers exactly like a
// missing one before any library code runs. This file calls a sample of those actions, one or more
// per module, as tenant A with tenant B's project id, and asserts:
//   - the result is the action's own "not available" refusal (its existing error shape);
//   - nothing of B's appears in the result;
//   - none of B's rows changed, and nothing was written under B's project id.
// Controls: the same actions on A's own project behave as before, and a missing project (a random
// id) gives the same refusal as B's project.
//
// Only the request context (who is signed in), Next's cache and the storage client are mocked.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

let currentTenant = "";
vi.mock("../requestContext", async () => {
  const real = await vi.importActual<typeof import("../requestContext")>("../requestContext");
  return {
    ...real,
    requireTenantId: async () => currentTenant,
    requireRequestContext: async () => ({ tenantId: currentTenant, userId: randomUUID(), email: null, organisationName: "A", role: "owner", memberships: [] }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.setConfig({ testTimeout: 60000 });

const A = randomUUID();
const B = randomUUID();
const NOT_AVAILABLE = "That project is not available.";

describe.skipIf(!TEST_DATABASE_URL)("SEC2 ownership at the entry of every run action (real database, superuser connection)", () => {
  let db: DisposableDb;
  let runA = "", runB = "", docA = "", docB = "", tableA = "", tableB = "", insightB = "";
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows[0];
  const rows = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  /** Every row stored under B's project, whichever tenant wrote it, to compare before and after. */
  const snapshotB = async () => ({
    tables: await rows("select id, tenant_id, label, crosstab from document_tables where run_id = $1 order by id", [runB]),
    findings: await rows("select id, tenant_id, status, finding_text from findings where run_id = $1 order by id", [runB]),
    memos: await rows("select id, tenant_id, body from coding_memos where run_id = $1 order by id", [runB]),
    insights: await rows("select id, tenant_id, headline, review_status from synthesized_insights where run_id = $1 order by id", [runB]),
    insightHistory: await rows("select original_synthesized_insight_id from synthesized_insight_history where run_id = $1", [runB]),
    candidates: await rows("select id, tenant_id, candidate_text, status from objective_candidates where run_id = $1 order by id", [runB]),
    evidence: await rows("select id, tenant_id, question from objective_evidence where run_id = $1 order by id", [runB]),
    drivers: await rows("select id, tenant_id, title from driver_analyses where run_id = $1 order by id", [runB]),
    recommendations: await rows("select id, tenant_id, action_text from recommendations where run_id = $1 order by id", [runB]),
  });
  const refused = (r: unknown) => expect(r).toMatchObject({ ok: false, error: NOT_AVAILABLE });
  const secretFree = (r: unknown) => expect(JSON.stringify(r ?? null)).not.toMatch(/secret/i);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    currentTenant = A;
    await db.pool.query("insert into tenants (id, name) values ($1,'A'),($2,'B')", [A, B]);
    runA = (await one("insert into runs (tenant_id, project_name) values ($1,'Project A') returning id", [A])).id;
    runB = (await one("insert into runs (tenant_id, project_name) values ($1,'Project B secret') returning id", [B])).id;
    const doc = async (tenant: string, run: string, name: string) =>
      (await one(
        "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type) values ($1,$2,'table',$3,$4,'raw') returning id",
        [tenant, run, name, `${tenant}/${run}/${name}`],
      )).id;
    docA = await doc(A, runA, "a.sav");
    docB = await doc(B, runB, "b-secret.sav");
    const crosstab = (label: string) => JSON.stringify({ version: 2, title: label, caption: `${label} caption`, columns: [], rows: [] });
    const table = async (tenant: string, run: string, document: string, label: string) =>
      (await one(
        `insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type, crosstab, crosstab_status)
         values ($1,$2,$3,100,$4,$5,$6,'raw',$7,'committed') returning id`,
        [tenant, run, document, label, JSON.stringify(["Q", label]), JSON.stringify([{ Q: "row", [label]: `${label} value` }]), crosstab(label)],
      )).id;
    tableA = await table(A, runA, docA, "A table");
    tableB = await table(B, runB, docB, "B secret table");
    // A chart finding and an NPS finding on each project's data file, so the status actions have something to report.
    for (const [tenant, run, document] of [[A, runA, docA], [B, runB, docB]]) {
      await db.pool.query(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1,$2,'generated','secret chart finding','Q1','level',$4,'quantitative','accepted',$3),
                ($1,$2,'generated','secret nps finding','Q1','level',$5,'quantitative','accepted',$3)`,
        [tenant, run, document, JSON.stringify({ source: "chart_tool", variable: "Q1" }), JSON.stringify({ source: "nps_tool", testType: "nps", variable: "Q1" })],
      );
    }
    await db.pool.query("insert into coding_memos (tenant_id, run_id, kind, body) values ($1,$2,'analytic','B secret memo')", [B, runB]);
    insightB = (await one(
      "insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication) values ($1,$2,'B secret insight','o','t','i') returning id",
      [B, runB],
    )).id;
    await db.pool.query(
      "insert into objective_evidence (tenant_id, run_id, item_kind, item_order, item_text, question, request_text) values ($1,$2,'objective',0,'Grow B secret','B secret question','r')",
      [B, runB],
    );
    await db.pool.query(
      "insert into driver_analyses (tenant_id, run_id, document_id, title, request, report) values ($1,$2,$3,'B secret drivers','{}','{}')",
      [B, runB, docB],
    );
  });

  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end().catch(() => {});
    await claimPool.end().catch(() => {});
    await db?.drop();
  });

  it("connects as a role that bypasses row-level security, so RLS cannot hide a defect here", async () => {
    const { pool } = await import("../db");
    const r = await pool.query("select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user");
    expect(r.rows[0].bypass).toBe(true);
  });

  it("crosstab: B's saved table cannot be read or retitled", async () => {
    const { loadCrosstabAction, setCrosstabTextAction, listCrosstabsAction } = await import("../crosstabActions");
    const before = await snapshotB();
    const read = await loadCrosstabAction(runB, tableB);
    refused(read);
    secretFree(read);
    refused(await setCrosstabTextAction(runB, tableB, "Hijacked", "Hijacked caption"));
    const list = await listCrosstabsAction(runB, docB);
    refused(list);
    secretFree(list);
    expect(await snapshotB()).toEqual(before);
    // Control: A's own table reads.
    expect(await loadCrosstabAction(runA, tableA)).toMatchObject({ ok: true, label: "A table" });
  });

  it("chart and NPS: whether B posted a finding is not revealed", async () => {
    const { chartFindingStatusAction } = await import("../chartActions");
    const { npsFindingStatusAction } = await import("../npsActions");
    const before = await snapshotB();
    refused(await chartFindingStatusAction(runB, docB, "Q1", null));
    refused(await npsFindingStatusAction(runB, docB, "Q1"));
    expect(await snapshotB()).toEqual(before);
    // Control: A's own findings are reported.
    expect(await chartFindingStatusAction(runA, docA, "Q1", null)).toEqual({ ok: true, committed: true });
    expect(await npsFindingStatusAction(runA, docA, "Q1")).toEqual({ ok: true, committed: true });
  });

  it("drivers: B's saved analyses are not listed", async () => {
    const { listDriverAnalysesAction } = await import("../driverActions");
    const r = await listDriverAnalysesAction(runB, docB);
    refused(r);
    secretFree(r);
    expect(await listDriverAnalysesAction(runA, docA)).toEqual({ ok: true, items: [] });
  });

  it("coding: no memo is written under B's project", async () => {
    const { addMemoAction } = await import("../codingAnalysisActions");
    const before = await snapshotB();
    refused(await addMemoAction(runB, null, null, "analytic", "Planted memo"));
    expect(await snapshotB()).toEqual(before);
    // Control: A's memo saves on A's project, under A.
    expect(await addMemoAction(runA, null, null, "analytic", "A memo")).toMatchObject({ ok: true });
    expect(await rows("select tenant_id from coding_memos where run_id = $1", [runA])).toEqual([{ tenant_id: A }]);
  });

  it("objectives: B's evidence questions are not read and no candidate is added to B", async () => {
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const { addOwnObjectiveCandidate } = await import("../objectiveCandidateActions");
    const before = await snapshotB();
    const r = await loadObjectiveEvidenceAction(runB);
    refused(r);
    secretFree(r);
    refused(await addOwnObjectiveCandidate(runB, "Planted objective"));
    expect(await snapshotB()).toEqual(before);
    expect(await loadObjectiveEvidenceAction(runA)).toMatchObject({ ok: true, questions: [] });
  });

  it("insights: B's synthesized insight cannot be deleted or accepted", async () => {
    const { deleteSynthesizedInsight, acceptSynthesizedInsight } = await import("../synthesizedInsightActions");
    const before = await snapshotB();
    await expect(deleteSynthesizedInsight(runB, insightB)).rejects.toThrow(NOT_AVAILABLE);
    await expect(acceptSynthesizedInsight(runB, insightB)).rejects.toThrow(NOT_AVAILABLE);
    expect(await snapshotB()).toEqual(before);
  });

  it("exports: the source view does not hand out B's table", async () => {
    const { getDocumentPreviewUrl } = await import("../previewActions");
    const r = await getDocumentPreviewUrl(runB, { sourceDocumentId: null, sourceTableId: tableB });
    expect(r).toEqual({ error: NOT_AVAILABLE });
  });

  it("recommendations: no recommendation is added to B's project", async () => {
    const { addOwnRecommendation } = await import("../recommendationActions");
    const before = await snapshotB();
    const fields = {
      action_text: "Planted", owner_role: "o", owner_feasibility_note: "n", timeline: "t", metric: "m", priority: "high",
      assumptions_and_risks: "a", alternatives_considered: "b",
    };
    refused(await addOwnRecommendation(runB, insightB, fields as never, randomUUID()));
    expect(await snapshotB()).toEqual(before);
  });

  it("a missing project answers exactly like B's project, and a malformed id is not a database error", async () => {
    const { loadCrosstabAction } = await import("../crosstabActions");
    const { addMemoAction } = await import("../codingAnalysisActions");
    expect(await loadCrosstabAction(randomUUID(), tableB)).toEqual(await loadCrosstabAction(runB, tableB));
    expect(await addMemoAction(randomUUID(), null, null, "analytic", "x")).toEqual(await addMemoAction(runB, null, null, "analytic", "x"));
    refused(await loadCrosstabAction("not-a-uuid", tableB));
  });
});
