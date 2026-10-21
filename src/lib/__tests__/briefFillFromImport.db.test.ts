// Set Objectives' "Fill in from a brief or proposal" (Grant 2026-10-19): briefs and proposals are
// imported under Import data, and Set Objectives only chooses which imported one(s) to fill blank
// fields from. Real database, the actual saveRunContext action; the model-backed field extraction
// is the external boundary and is controlled here.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const intake = vi.hoisted(() => ({ calls: [] as { briefText?: string | null; proposalText?: string | null }[], objective: "Objective from the brief" }));
vi.mock("../briefIntake", () => ({
  extractBriefFields: vi.fn(async (_t: string, _r: string, docs: { briefText?: string | null; proposalText?: string | null }) => {
    intake.calls.push(docs);
    return { businessProblem: `Problem from: ${docs.briefText ?? docs.proposalText}`, researchObjective: intake.objective };
  }),
}));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("Set Objectives fills blank fields from an imported brief (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string, brief: string, foreign: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic intake')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
    const doc = async (r: string, text: string) =>
      (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'evidence','brief.docx',$3,$4) returning id", [tenant, r, `${tenant}/${r}/brief.docx`, text])).rows[0].id as string;
    brief = await doc(run, "Imported brief text");
    foreign = await doc(other, "Another project's brief");
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    intake.calls.length = 0;
    intake.objective = "Objective from the brief";
  });
  const save = async (runId: string, fields: Record<string, string>) => {
    const { saveRunContext } = await import("../runContextActions");
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    await saveRunContext(runId, form);
    return (await db.pool.query("select business_problem, stated_objectives_text from runs where id=$1", [runId])).rows[0];
  };

  it("an ordinary save with nothing chosen calls no extraction", async () => {
    await save(run, { businessProblem: "", researchObjective: "", audience: "" });
    expect(intake.calls).toEqual([]);
  });

  it("a chosen imported brief fills only the blank fields; typed text wins", async () => {
    const row = await save(run, { businessProblem: "Typed problem", researchObjective: "", audience: "", briefDocumentId: brief });
    expect(intake.calls).toEqual([{ briefText: "Imported brief text", proposalText: null }]);
    expect(row.business_problem).toBe("Typed problem");
    expect(row.stated_objectives_text).toContain("Objective from the brief");
  });

  it("a document from another project is refused, and what was typed is still saved", async () => {
    const row = await save(run, { businessProblem: "Kept problem", researchObjective: "", audience: "", briefDocumentId: foreign });
    expect(intake.calls).toEqual([]);
    expect(row.business_problem).toBe("Kept problem");
    const trace = (await db.pool.query("select detail from trace where run_id=$1 and event='brief_intake_error' order by id desc limit 1", [run])).rows[0];
    expect(trace.detail.message).toMatch(/not in this project/);
  });

  // Grant, 2026-10-21: filling from the same proposal again added every objective a second time.
  it("filling from the same document again adds no objective that is already there, in any spelling", async () => {
    const fresh = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Dup') returning id", [tenant])).rows[0].id as string;
    const proposal = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'evidence','proposal.docx',$3,'Proposal text') returning id", [tenant, fresh, `${tenant}/${fresh}/proposal.docx`])).rows[0].id as string;
    const candidates = async () => (await db.pool.query("select candidate_text, status from objective_candidates where run_id=$1 order by candidate_text", [fresh])).rows;
    intake.objective = "1. Understand why customers switch provider\n2. Size the opportunity in rural areas";
    const first = await save(fresh, { businessProblem: "", researchObjective: "", audience: "", proposalDocumentId: proposal });
    expect(first.stated_objectives_text.split("\n")).toEqual(["Understand why customers switch provider", "Size the opportunity in rural areas"]);
    expect(await candidates()).toHaveLength(2);
    // The same proposal read again, with a full stop, other capitals, curly quotes and spacing.
    intake.objective = "- understand why customers  switch provider.\n- Size the opportunity in rural areas;\n- Test the \u201cbundle\u201d offer";
    const second = await save(fresh, { businessProblem: "", researchObjective: "", audience: "", proposalDocumentId: proposal });
    expect(second.stated_objectives_text.split("\n")).toEqual(["Understand why customers switch provider", "Size the opportunity in rural areas", "Test the \u201cbundle\u201d offer"]);
    expect((await candidates()).map((r) => r.candidate_text)).toEqual(["Size the opportunity in rural areas", "Test the \u201cbundle\u201d offer", "Understand why customers switch provider"]);
    // An objective Review holds (suggested, then rejected by the researcher) is not brought back.
    await db.pool.query("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Measure loyalty by segment','Suggested','ai_suggested','rejected')", [tenant, fresh]);
    intake.objective = "Measure loyalty by segment.";
    const third = await save(fresh, { businessProblem: "", researchObjective: "", audience: "", proposalDocumentId: proposal });
    expect(third.stated_objectives_text).not.toMatch(/loyalty/i);
    expect((await candidates()).filter((r) => /loyalty/i.test(r.candidate_text))).toEqual([{ candidate_text: "Measure loyalty by segment", status: "rejected" }]);
    // Two lines of one read that are the same objective are added once.
    intake.objective = "Track churn monthly\ntrack churn monthly.";
    await save(fresh, { businessProblem: "", researchObjective: "", audience: "", proposalDocumentId: proposal });
    expect((await candidates()).filter((r) => /churn/i.test(r.candidate_text))).toHaveLength(1);
  });

  it("two saves of the same new objective at once add it once", async () => {
    const fresh = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Race') returning id", [tenant])).rows[0].id as string;
    await Promise.all([
      save(fresh, { businessProblem: "", researchObjective: "Reach first-time buyers", audience: "" }),
      save(fresh, { businessProblem: "", researchObjective: "Reach first-time buyers.", audience: "" }),
    ]);
    expect((await db.pool.query("select count(*)::int as n from objective_candidates where run_id=$1", [fresh])).rows[0].n).toBe(1);
    expect((await db.pool.query("select stated_objectives_text from runs where id=$1", [fresh])).rows[0].stated_objectives_text.split("\n")).toHaveLength(1);
  });
});
