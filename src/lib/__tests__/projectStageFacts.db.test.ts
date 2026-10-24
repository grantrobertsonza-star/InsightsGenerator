// The section dashboards' stored-record facts (projectStageFacts.ts), read from a real database
// built from every migration: each module's facts come from the records a researcher's work leaves,
// and a project that cannot be read throws rather than looking empty.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "controlled" }));

describe.skipIf(!TEST_DATABASE_URL)("project stage facts (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, empty: string, raw: string, transcript: string, report: string;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    const q = (sql: string, args: unknown[]) => db.pool.query(sql, args);
    await q("insert into tenants(id,name) values($1,'Synthetic stage facts')", [tenant]);
    [run, empty] = (await q("insert into runs(tenant_id,project_name,stated_objectives_text) values($1,'Full','1. Understand lapse'),($1,'Empty',null) returning id", [tenant])).rows.map((r) => r.id);
    const doc = async (kind: string, name: string, extra: string, vals: unknown[]) =>
      (await q(`insert into documents(tenant_id,run_id,kind,source_filename,storage_path${extra}) values($1,$2,$3,$4,$5${vals.map((_, i) => `,$${6 + i}`).join("")}) returning id`, [tenant, run, kind, name, `${tenant}/${run}/${name}`, ...vals])).rows[0].id as string;
    raw = await doc("table", "survey.csv", ",ingestion_type,data_setup", ["raw", JSON.stringify({ unit: "person", layout: "wide", method: "survey", accepted: false })]);
    transcript = await doc("transcript", "interview.docx", ",extracted_text", ["Interviewer: hello. Respondent: hello."]);
    report = await doc("report", "report.pdf", ",extracted_text,processing_status", ["A report text.", "failed"]);
    await q("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type,headers,rows) values($1,$2,$3,0,'raw','[\"a\"]','[{\"a\":1}]')", [tenant, run, raw]);
    await q("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type,headers,rows,crosstab_status) values($1,$2,$3,100,'aggregated','[]','[]','draft'),($1,$2,$3,101,'aggregated','[]','[]','committed'),($1,$2,$3,102,'aggregated','[]','[]','evidence')", [tenant, run, raw]);
    await q("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Understand lapse','typed','researcher_authored','accepted'),($1,$2,'Size the market','suggested','ai_suggested','pending')", [tenant, run]);
    await q("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Whether to reprice','typed','researcher_authored','accepted')", [tenant, run]);
    await q("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated','A',$3),($1,$2,'generated','B','pending'),($1,$2,'generated','C','rejected')", [tenant, run, "accepted"]);
    await q("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'story_narrative_error',$3)", [tenant, run, JSON.stringify({ message: "Model unavailable" })]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("reads each module's facts from the stored records", async () => {
    const { loadProjectStageFacts } = await import("../projectStageFacts");
    const f = await loadProjectStageFacts(tenant, run);
    const file = (id: string) => f.import.files.find((x) => x.documentId === id)!;
    expect(file(raw)).toMatchObject({ processing: "read", acceptance: "needs_review" });
    expect(file(transcript)).toMatchObject({ processing: "read", acceptance: "needs_review" });
    expect(file(report)).toMatchObject({ processing: "failed", acceptance: "none" });
    // Fuller checks are not loaded here.
    expect(file(raw).previewUnverified).toBeUndefined();
    expect(f.crosstabs.files).toEqual([{ id: raw, filename: "survey.csv", state: "needs_setup", draftTables: 1, committedTables: 1 }]);
    expect(f.objectives.objectives.map((o) => [o.text, o.status])).toEqual([
      ["Understand lapse", "accepted"],
      ["Size the market", "pending"],
    ]);
    expect(f.decisions).toMatchObject({ pending: 0, accepted: 1 });
    expect(f.coding.transcripts).toEqual([{ id: transcript, filename: "interview.docx", setupAccepted: false, coded: false }]);
    expect(f.reports.reports).toEqual([{ id: report, filename: "report.pdf", failed: true, claims: 0 }]);
    expect(f.findings).toMatchObject({ total: 3, pending: 1, accepted: 1, rejected: 1, hasSources: true });
    expect(f.report).toEqual({ generatedAt: null, error: "Model unavailable" });
  });

  it("an empty project has no files and asks for everything; an unknown project throws", async () => {
    const { loadProjectStageFacts, loadProjectOverviews } = await import("../projectStageFacts");
    const f = await loadProjectStageFacts(tenant, empty);
    expect(f.import.files).toEqual([]);
    expect(f.findings).toMatchObject({ total: 0, hasSources: false });
    await expect(loadProjectStageFacts(tenant, randomUUID())).rejects.toThrow("not found");
    const rows = await loadProjectOverviews(tenant, [run, empty, randomUUID()]);
    expect(rows.get(run)).toMatchObject({ ok: true, next: { section: "prepare", moduleId: "upload" } });
    expect([...rows.values()].filter((r) => !r.ok)).toHaveLength(1);
  });
});
