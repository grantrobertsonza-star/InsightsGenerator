// OBJ-REV-007 and OBJ-REV-012, verified against a REAL PostgreSQL (disposable database from the
// migrations) through the app's own db.ts. These were reported fixed but never independently run.
//   007a  an actual wording edit bumps the revision, drops the numeric expectation and clears old
//         answers; re-saving identical text changes nothing
//   007b  a result whose table is deleted (real FK on delete set null) is reported stale and no
//         longer counts toward the question's stance
//   007c  editing a question that no longer exists fails visibly (lock query confirms its row)
//   012   a conclusion generated while evidence retrieval was degraded keeps that qualification in
//         the DOCX export after a reload (the actual route, reading the persisted flag)
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/docxReport", async () => await import("../docxReport"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
// Discovery data is not what these tests are about: an empty section, with the real support rule.
vi.mock("@/lib/discoveryReport", async () => ({
  ...(await import("../discoveryReport")),
  loadDiscoveryReportData: vi.fn(async () => ({ inputState: "complete", netNewSources: [], verificationNote: null, netNewInsights: [], netNewFindings: [], netNewFindingsOmitted: 0, contradictions: [] })),
}));
vi.mock("@/lib/exportChartImages", () => ({ buildChartImagesByTheme: vi.fn(async () => []) }));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));

const TENANT = "00000000-0000-4000-8000-0000000000bb";

describe.skipIf(!TEST_DATABASE_URL)("objective review persistence (real database)", () => {
  let db: DisposableDb;
  let run = "";
  let data = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;

  async function question(text: string): Promise<string> {
    return one(
      `insert into objective_evidence (tenant_id, run_id, item_kind, item_order, item_text, question, request_text, supports_if, against_if, expectation, origin_recorded)
       values ($1, $2, 'objective', 0, 'Grow purchase', $3, 'purchase by gender', 'women higher', 'men higher',
               '{"kind":"comparison","direction":"higher","groupA":"Female","groupB":"Male"}', false) returning id`,
      [TENANT, run, text],
    );
  }
  async function result(evidenceId: string, tableId: string | null): Promise<void> {
    await db.pool.query(
      `insert into objective_evidence_results (tenant_id, run_id, evidence_id, document_id, dataset_name, table_id, stance, basis, summary, had_table)
       values ($1, $2, $3, $4, 'survey.xlsx', $5, 'supports', 'computed', 'Female 60% vs Male 40%', $6)`,
      [TENANT, run, evidenceId, data, tableId, tableId !== null],
    );
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name, research_objective) values ($1, 'Objectives', 'Grow purchase') returning id`, [TENANT]);
    data = await one(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type) values ($1, $2, 'table', 'survey.xlsx', 'p', 'raw') returning id`,
      [TENANT, run],
    );
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  const rowOf = async (id: string) =>
    (await db.pool.query(`select question, question_revision, expectation, source from objective_evidence where id = $1`, [id])).rows[0];
  const resultCount = async (id: string) =>
    Number((await db.pool.query(`select count(*) from objective_evidence_results where evidence_id = $1`, [id])).rows[0].count);

  it("007a: re-saving identical text changes nothing; an actual wording edit bumps the revision, drops the expectation and clears answers", async () => {
    const { editEvidenceQuestion } = await import("../objectiveEvidence");
    const q = await question("Do women buy more than men?");
    await result(q, null);
    await editEvidenceQuestion(TENANT, run, q, { question: "Do women buy more than men?" });
    expect(await rowOf(q)).toMatchObject({ question_revision: 0, source: "auto" });
    expect((await rowOf(q)).expectation).not.toBeNull();
    expect(await resultCount(q)).toBe(1);

    await editEvidenceQuestion(TENANT, run, q, { question: "Do younger women buy more than younger men?" });
    expect(await rowOf(q)).toMatchObject({ question_revision: 1, source: "edited", expectation: null });
    expect(await resultCount(q)).toBe(0);
  });

  it("007b: deleting the source table (real cascade rule) makes the result stale and removes it from the stance", async () => {
    const { listObjectiveEvidence } = await import("../objectiveEvidence");
    const table = await one(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type, crosstab) values ($1, $2, $3, 100, 'raw', '{}') returning id`,
      [TENANT, run, data],
    );
    const q = await question("Is purchase higher among women?");
    await result(q, table);
    const before = (await listObjectiveEvidence(TENANT, run)).find((x) => x.id === q)!;
    expect(before.stance).toBe("supports");
    expect(before.results[0].stale).toBe(false);

    await db.pool.query(`delete from document_tables where id = $1`, [table]);
    const after = (await listObjectiveEvidence(TENANT, run)).find((x) => x.id === q)!;
    expect(after.results[0].stale).toBe(true);
    expect(after.stance).toBeNull();
  });

  it("007c: editing a question that no longer exists fails visibly instead of reporting success", async () => {
    const { editEvidenceQuestion } = await import("../objectiveEvidence");
    const q = await question("Temporary question");
    await db.pool.query(`delete from objective_evidence where id = $1`, [q]);
    await expect(editEvidenceQuestion(TENANT, run, q, { question: "Changed" })).rejects.toThrow(/no longer exists/);
  });

  it("012: a degraded evidence check keeps its qualification in the exported report after reload", async () => {
    const insight = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count)
       values ($1, $2, 'Women buy more', 'o', 't', 'i', 0, 1) returning id`,
      [TENANT, run],
    );
    await db.pool.query(
      `insert into deck_narratives (tenant_id, run_id, situation, complication, question, governing_thought, pillars, executive_summary)
       values ($1, $2, 's', 'c', 'q', 'g', $3, 'summary')`,
      [TENANT, run, JSON.stringify([{ theme: "T", headline: "Pillar", so_what: "w", insight_ids: [insight] }])],
    );
    await db.pool.query(
      `insert into objective_validations (tenant_id, run_id, item_kind, item_order, item_text, status, conclusion, evidence_digest_degraded)
       values ($1, $2, 'objective', 0, 'Grow purchase', 'partial', 'Purchase appears higher among women.', true)`,
      [TENANT, run],
    );
    const { GET } = await import("../../app/api/runs/[id]/story/export-docx/route");
    const res = await GET(new Request("http://x/"), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    const text = xml.replace(/<[^>]+>/g, "");
    expect(text).toContain("Purchase appears higher among women.");
    expect(text).toContain("Evidence check degraded");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("objective review persistence (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
