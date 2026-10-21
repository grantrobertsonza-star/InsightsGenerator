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
const intake = vi.hoisted(() => ({ calls: [] as { briefText?: string | null; proposalText?: string | null }[], objective: "Objective from the brief", fail: false }));
vi.mock("../briefIntake", () => ({
  extractBriefFields: vi.fn(async (_t: string, _r: string, docs: { briefText?: string | null; proposalText?: string | null }) => {
    intake.calls.push(docs);
    if (intake.fail) throw new Error("Synthetic extraction failure");
    return { businessProblem: `Problem from: ${docs.briefText ?? docs.proposalText}`, researchObjective: intake.objective };
  }),
}));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));
// Scoring now runs after each save; the model is not this test's subject.
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));

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
    intake.fail = false;
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

  // Grant, 2026-10-21: Set objectives did not say which brief or proposal filled it.
  describe("which document filled Set objectives", () => {
    const usedRows = async (runId: string) =>
      (await db.pool.query("select detail from trace where run_id=$1 and event='brief_intake_used' order by id", [runId])).rows.map((r) => r.detail);
    const newRun = async (name: string) => (await db.pool.query("insert into runs(tenant_id,project_name) values($1,$2) returning id", [tenant, name])).rows[0].id as string;
    const newDoc = async (runId: string, filename: string) =>
      (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'evidence',$3,$4,'Document text') returning id", [tenant, runId, filename, `${tenant}/${runId}/${filename}`])).rows[0].id as string;

    it("records the document and what it filled, labels the objectives it added, and leaves typed ones alone", async () => {
      const r = await newRun("Fill record");
      const proposal = await newDoc(r, "ConnectMobile_Proposal.docx");
      const brief = await newDoc(r, "Client_Brief.pdf");
      const { loadLastBriefFill, loadObjectiveSources } = await import("../briefFillRecord");
      const { objectiveIdentityKey } = await import("../objectiveLines");
      expect(await loadLastBriefFill(tenant, r)).toBeNull();
      intake.objective = "Reach rural users\nTest the bundle offer";
      await save(r, { businessProblem: "", researchObjective: "", audience: "", proposalDocumentId: proposal });
      expect(await usedRows(r)).toEqual([
        {
          briefDocumentId: null,
          briefFilename: null,
          proposalDocumentId: proposal,
          proposalFilename: "ConnectMobile_Proposal.docx",
          filledBusinessProblem: true,
          objectivesAdded: 2,
          // Import lineage (GT500-F01): every key read from the document, and what it became.
          importedBefore: 0,
          extractedKeys: ["reach rural users", "test the bundle offer"],
          addedCandidateIds: expect.any(Array),
        },
      ]);
      const rationales = (await db.pool.query("select candidate_text, rationale from objective_candidates where run_id=$1 order by candidate_text", [r])).rows;
      expect(rationales).toEqual([
        { candidate_text: "Reach rural users", rationale: 'Added from the proposal "ConnectMobile_Proposal.docx"' },
        { candidate_text: "Test the bundle offer", rationale: 'Added from the proposal "ConnectMobile_Proposal.docx"' },
      ]);
      // Typed text wins and keeps its own rationale; the document then filled only the problem.
      await save(r, { businessProblem: "", researchObjective: "My own objective", audience: "", briefDocumentId: brief, proposalDocumentId: proposal });
      expect((await db.pool.query("select rationale from objective_candidates where run_id=$1 and candidate_text='My own objective'", [r])).rows[0].rationale).toBe("Written or imported at project set-up.");
      const last = await loadLastBriefFill(tenant, r);
      expect(last).toMatchObject({
        brief: { id: brief, filename: "Client_Brief.pdf", stillImported: true },
        proposal: { id: proposal, filename: "ConnectMobile_Proposal.docx", stillImported: true },
        objectivesAdded: 0,
      });
      const sources = await loadObjectiveSources(tenant, r);
      expect(sources instanceof Map && sources.get(objectiveIdentityKey("reach rural users."))).toBe('Added from the proposal "ConnectMobile_Proposal.docx"');
      expect(sources instanceof Map && sources.has(objectiveIdentityKey("My own objective"))).toBe(false);
      // A deleted document is named, as no longer imported.
      await db.pool.query("delete from documents where id=$1", [brief]);
      expect(await loadLastBriefFill(tenant, r)).toMatchObject({ brief: { filename: "Client_Brief.pdf", stillImported: false }, proposal: { stillImported: true } });
    });

    it("records nothing for a refused document or a failed read", async () => {
      const r = await newRun("No record");
      await save(r, { businessProblem: "", researchObjective: "", audience: "", briefDocumentId: foreign });
      const doc = await newDoc(r, "Brief.docx");
      intake.fail = true;
      await save(r, { businessProblem: "", researchObjective: "", audience: "", briefDocumentId: doc });
      expect(await usedRows(r)).toEqual([]);
      const { loadLastBriefFill } = await import("../briefFillRecord");
      expect(await loadLastBriefFill(tenant, r)).toBeNull();
    });

    it("a failed lookup is reported as unknown, not as never filled", async () => {
      const { loadLastBriefFill, loadObjectiveSources } = await import("../briefFillRecord");
      // Not a uuid: the query itself fails.
      expect(await loadLastBriefFill(tenant, "not-a-run-id")).toEqual({ error: expect.any(String) });
      expect(await loadObjectiveSources(tenant, "not-a-run-id")).toEqual({ error: expect.any(String) });
    });
  });
});
