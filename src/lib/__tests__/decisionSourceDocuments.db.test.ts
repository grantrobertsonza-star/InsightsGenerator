// The decision framer records the files its suggestions were drawn from (migration 0115,
// candidateSourceDocuments.ts), through the actual generateDecisionCandidates on a real disposable
// PostgreSQL; only the model is scripted.
//   one file      every finding read comes from one report (directly, or through one of its tables):
//                 the suggestions name that report
//   two files     findings from two reports: both, sorted
//   unknown       one finding with no recorded file: unknown (null), so removing a file never takes it
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string } }) =>
        req.tool_choice.name === "record_evidence_synthesis"
          ? { content: [{ type: "tool_use", name: req.tool_choice.name, input: { synthesis: "Synthesis." } }], usage: { input_tokens: 1, output_tokens: 1 } }
          : {
              content: [{ type: "tool_use", name: req.tool_choice.name, input: { candidates: [{ candidate_text: `Whether to act ${randomUUID().slice(0, 6)}`, rationale: "r" }] } }],
              usage: { input_tokens: 1, output_tokens: 1 },
              stop_reason: "tool_use",
            },
      ),
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.setConfig({ testTimeout: 60000 });

const T = randomUUID();

describe.skipIf(!TEST_DATABASE_URL)("decision suggestions record their files (real database)", () => {
  let db: DisposableDb;
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows[0];
  const newRun = async () => (await one("insert into runs (tenant_id, project_name, entry_point) values ($1,'P','validate') returning id", [T])).id as string;
  const doc = async (r: string, name: string) =>
    (await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1,$2,'report',$3,$4) returning id", [T, r, name, `${T}/${r}/${randomUUID()}`])).id as string;
  const finding = async (r: string, column: "source_document_id" | "source_table_id" | null, id: string | null) =>
    db.pool.query(
      `insert into findings (tenant_id, run_id, origin, finding_text, status${column ? `, ${column}` : ""}) values ($1,$2,'stated',$3,'accepted'${column ? ", $4" : ""})`,
      column ? [T, r, `F ${randomUUID()}`, id] : [T, r, `F ${randomUUID()}`],
    );
  const sourcesOf = async (r: string) => (await one("select source_document_ids from decision_candidates where run_id = $1", [r])).source_document_ids as string[] | null;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    await db.pool.query("insert into tenants (id, name) values ($1,'T')", [T]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("one file, directly and through its table: the suggestion names that file", async () => {
    const r = await newRun();
    const d = await doc(r, "report.docx");
    const table = (await one("insert into document_tables (tenant_id, run_id, document_id, table_index, headers, rows, ingestion_type) values ($1,$2,$3,0,'[]','[]','aggregated') returning id", [T, r, d])).id;
    await finding(r, "source_document_id", d);
    await finding(r, "source_table_id", table);
    const { generateDecisionCandidates } = await import("../decisionFramer");
    await generateDecisionCandidates(T, r);
    expect(await sourcesOf(r)).toEqual([d]);
  });

  it("two files: both, sorted", async () => {
    const r = await newRun();
    const [a, b] = [await doc(r, "a.docx"), await doc(r, "b.docx")];
    await finding(r, "source_document_id", a);
    await finding(r, "source_document_id", b);
    const { generateDecisionCandidates } = await import("../decisionFramer");
    await generateDecisionCandidates(T, r);
    expect(await sourcesOf(r)).toEqual([a, b].sort());
  });

  it("a finding with no recorded file makes the sources unknown", async () => {
    const r = await newRun();
    await finding(r, "source_document_id", await doc(r, "a.docx"));
    await finding(r, null, null);
    const { generateDecisionCandidates } = await import("../decisionFramer");
    await generateDecisionCandidates(T, r);
    expect(await sourcesOf(r)).toBeNull();
  });
});
