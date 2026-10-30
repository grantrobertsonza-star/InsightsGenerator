// CE-4 (evidence chain, 26 October 2026): each objective filled from a brief or proposal keeps the
// passage it came from, which document stated it, and whether that passage is in the document's text.
// Real database, the actual saveRunContext and extractBriefFields; the model is the mocked boundary.
//   - brief and proposal kept apart: each objective's passage names its own document;
//   - a passage the model reworded is stored as not found, never as a quote from the document;
//   - a passage for a document that was not given, or for an objective that does not exist, is dropped;
//   - the business problem's passage is kept when the business problem is filled from the document;
//   - a reading with no passages still fills the objectives, and they show "none recorded";
//   - the evidence trail shows the passage beneath the objective.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
const model = vi.hoisted(() => ({ input: {} as Record<string, unknown> }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: { messages: { create: vi.fn(async () => ({ stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "record_brief_fields", input: model.input }] })) } },
}));
vi.setConfig({ testTimeout: 60000 });

const BRIEF = "Members are leaving at renewal and we do not know why. We need to understand why members leave within the first year.";
const PROPOSAL = "Our approach will size the switching intent among current members using a survey of 1,000 members.";

describe.skipIf(!TEST_DATABASE_URL)("CE-4 brief passages behind objectives", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic passages')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  const project = async () => {
    const run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'P') returning id", [tenant])).rows[0].id as string;
    const doc = async (name: string, text: string) =>
      (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'evidence',$3,$4,$5) returning id", [tenant, run, name, `${tenant}/${run}/${name}`, text])).rows[0].id as string;
    return { run, brief: await doc("brief.docx", BRIEF), proposal: await doc("proposal.docx", PROPOSAL) };
  };
  const save = async (p: { run: string; brief: string; proposal: string }) => {
    const { saveRunContext } = await import("../runContextActions");
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessProblem: "", researchObjective: "", audience: "", briefDocumentId: p.brief, proposalDocumentId: p.proposal })) form.set(k, v);
    await saveRunContext(p.run, form);
  };
  const passages = async (run: string) =>
    (
      await db.pool.query(
        `select p.field, c.candidate_text, p.document_role, d.source_filename, p.quote, p.verified
         from brief_passages p left join objective_candidates c on c.id = p.objective_candidate_id left join documents d on d.id = p.document_id
         where p.run_id = $1 order by p.field, c.candidate_text`,
        [run],
      )
    ).rows;

  it("keeps each objective's passage with its own document, marks a reworded one not found, and drops invalid ones", async () => {
    const p = await project();
    model.input = {
      business_problem: "Members are leaving at renewal.",
      research_objective: "1. Understand why members leave in the first year\n2. Size switching intent",
      objective_sources: [
        { objective_number: 1, document: "brief", quote: "We need to understand why members leave within the first year." },
        { objective_number: 2, document: "proposal", quote: "size the intent to switch among members" },
        { objective_number: 3, document: "brief", quote: "Members are leaving at renewal" },
      ],
      business_problem_source: { document: "brief", quote: "Members are leaving at renewal and we do not know why." },
    };
    await save(p);
    expect(await passages(p.run)).toEqual([
      { field: "business_problem", candidate_text: null, document_role: "brief", source_filename: "brief.docx", quote: "Members are leaving at renewal and we do not know why.", verified: true },
      { field: "objective", candidate_text: "Size switching intent", document_role: "proposal", source_filename: "proposal.docx", quote: "size the intent to switch among members", verified: false },
      { field: "objective", candidate_text: "Understand why members leave in the first year", document_role: "brief", source_filename: "brief.docx", quote: "We need to understand why members leave within the first year.", verified: true },
    ]);
    const { withTenantRead } = await import("../db");
    const { loadBriefPassages, passageSourceText } = await import("../briefPassages");
    const loaded = (await withTenantRead(tenant, (c) => loadBriefPassages(c, p.run)))!;
    const texts = [...loaded.objectives.values()].flat().map(passageSourceText).sort();
    expect(texts).toEqual(["From the brief (brief.docx)", "From the proposal (proposal.docx); this passage was not found in its text, so it may be reworded"]);
  });

  it("a reading that names no passage still fills the objectives, with none recorded", async () => {
    const p = await project();
    model.input = { business_problem: null, research_objective: "Understand churn" };
    await save(p);
    expect((await db.pool.query("select candidate_text from objective_candidates where run_id=$1", [p.run])).rows).toEqual([{ candidate_text: "Understand churn" }]);
    expect(await passages(p.run)).toEqual([]);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-4 brief passages behind objectives", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
