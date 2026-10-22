// Filling from the same proposal again (Grant, 2026-10-22: linking the proposal again added
// duplicate objectives, because each read re-words them and the identity check is exact). Real
// database, the actual saveRunContext; only the model-backed extraction and scoring are controlled.
//   1. A document that already filled the project is not read again and adds nothing; the save
//      says so. A document with the same content counts as the same document.
//   2. Read it again re-reads it and adds only new lines, as pending suggestions for review, never
//      accepted and never in the stated list; a reworded line is placed beside its likely match.
//   3. A different document fills normally. Typed, edited, rejected and deleted objectives stay.
//   4. Concurrent fills of one document, a retried re-read, and a failed re-read.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const intake = vi.hoisted(() => ({ answers: [] as string[], fail: null as string | null, calls: 0, gate: null as Promise<void> | null }));
vi.mock("../briefIntake", () => ({
  extractBriefFields: vi.fn(async () => {
    const n = intake.calls++;
    if (intake.gate) await intake.gate;
    if (intake.fail) throw new Error(intake.fail);
    // Each read answers with the next wording, as a model re-reading the same text can.
    return { businessProblem: null, researchObjective: intake.answers[Math.min(n, intake.answers.length - 1)] ?? "" };
  }),
}));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../objectiveValidator", () => ({ refreshObjectiveValidationQuietly: vi.fn(async () => {}) }));

const FIRST = "Measure rural demand for affordable mobile bundles\nUnderstand why customers switch provider";
// The same two objectives, worded differently, plus one genuinely new.
const REWORDED = "Measure demand for affordable mobile bundles in rural areas\nUnderstand the reasons customers switch provider\nTest the family bundle offer";

describe.skipIf(!TEST_DATABASE_URL)("Filling again from a proposal that already filled the project (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic reread')", [tenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    intake.answers = [];
    intake.fail = null;
    intake.calls = 0;
    intake.gate = null;
  });

  const newRun = async () => (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Reread') returning id", [tenant])).rows[0].id as string;
  const newDoc = async (run: string, filename = "Proposal.docx", sha: string | null = null, kind = "evidence") =>
    (await db.pool.query(
      "insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text,content_sha256) values($1,$2,$6,$3,$4,'Proposal text',$5) returning id",
      [tenant, run, filename, `${tenant}/${run}/${randomUUID()}`, sha, kind],
    )).rows[0].id as string;
  const save = async (run: string, fields: Record<string, string>) => {
    const { saveRunContext } = await import("../runContextActions");
    const form = new FormData();
    form.set("businessProblem", "");
    form.set("researchObjective", "");
    form.set("audience", "");
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return saveRunContext(run, form);
  };
  const candidates = async (run: string) =>
    (await db.pool.query<{ id: string; candidate_text: string; status: string; rationale: string }>(
      "select id, candidate_text, status, rationale from objective_candidates where run_id=$1 order by candidate_text, id",
      [run],
    )).rows;
  const stated = async (run: string) => (await db.pool.query("select stated_objectives_text from runs where id=$1", [run])).rows[0].stated_objectives_text as string | null;

  it("the same document again is not read, adds nothing and says so; typed fields still save", async () => {
    const run = await newRun();
    const doc = await newDoc(run);
    intake.answers = [FIRST, REWORDED];
    expect((await save(run, { proposalDocumentId: doc })).fill).toMatchObject({ status: "filled", objectivesAdded: 2 });
    const before = await candidates(run);
    const again = await save(run, { proposalDocumentId: doc, businessProblem: "Typed after the first fill" });
    expect(intake.calls).toBe(1);
    expect(again.fill).toBeNull();
    expect(again.already).toMatchObject({ documents: "the proposal Proposal.docx", objectivesFromIt: 2, briefDocumentId: null, proposalDocumentId: doc });
    expect(await candidates(run)).toEqual(before);
    expect((await db.pool.query("select business_problem from runs where id=$1", [run])).rows[0].business_problem).toBe("Typed after the first fill");
    // The refused re-read leaves no fill record of its own.
    expect(Number((await db.pool.query("select count(*) from trace where run_id=$1 and event='brief_intake_used'", [run])).rows[0].count)).toBe(1);
  });

  // The same content cannot be imported twice as the same kind (IMP-008, migration 0098), but can be
  // as another kind, for example once as a report and once as evidence.
  it("the same content imported as another kind counts as the same document", async () => {
    const run = await newRun();
    const first = await newDoc(run, "Proposal.docx", "sha-identical");
    const copy = await newDoc(run, "Proposal (1).docx", "sha-identical", "report");
    intake.answers = [FIRST, REWORDED];
    await save(run, { proposalDocumentId: first });
    const again = await save(run, { proposalDocumentId: copy });
    expect(intake.calls).toBe(1);
    expect(again.already).toMatchObject({ documents: "the proposal Proposal (1).docx", objectivesFromIt: 2, proposalDocumentId: copy });
    expect(await candidates(run)).toHaveLength(2);
  });

  it("Read it again adds only new lines, as pending suggestions with their source, beside their likely match", async () => {
    const run = await newRun();
    const doc = await newDoc(run);
    intake.answers = [FIRST, REWORDED];
    await save(run, { proposalDocumentId: doc });
    const statedBefore = await stated(run);
    const reread = await save(run, { proposalDocumentId: doc, rereadDocuments: "1" });
    expect(intake.calls).toBe(2);
    expect(reread.fill).toMatchObject({ status: "filled", reread: true, objectivesAdded: 0, suggestionsAdded: 3 });
    expect(reread.already).toBeNull();
    const rows = await candidates(run);
    const pending = rows.filter((r) => r.status === "pending");
    expect(pending.map((r) => r.candidate_text)).toEqual([
      "Measure demand for affordable mobile bundles in rural areas",
      "Test the family bundle offer",
      "Understand the reasons customers switch provider",
    ]);
    for (const p of pending) expect(p.rationale).toBe('Suggested on re-reading the proposal "Proposal.docx"');
    // Nothing accepted, nothing in the stated list.
    expect(rows.filter((r) => r.status === "accepted")).toHaveLength(2);
    expect(await stated(run)).toBe(statedBefore);
    // Placement only: the reworded lines sit beside the objectives they restate; the new one beside none.
    const { likelyRestates } = await import("../objectiveSimilarity");
    const accepted = rows.filter((r) => r.status === "accepted").map((r) => ({ text: r.candidate_text }));
    expect(likelyRestates("Measure demand for affordable mobile bundles in rural areas", accepted)?.text).toBe("Measure rural demand for affordable mobile bundles");
    expect(likelyRestates("Understand the reasons customers switch provider", accepted)?.text).toBe("Understand why customers switch provider");
    expect(likelyRestates("Test the family bundle offer", accepted)).toBeNull();
    const { loadLastBriefFill } = await import("../briefFillRecord");
    expect(await loadLastBriefFill(tenant, run)).toMatchObject({ objectivesAdded: 0, suggestionsAdded: 3 });
  });

  it("a retried re-read with the same answer suggests nothing twice; a rejected suggestion is not suggested again", async () => {
    const run = await newRun();
    const doc = await newDoc(run);
    intake.answers = [FIRST, REWORDED, REWORDED, REWORDED];
    await save(run, { proposalDocumentId: doc });
    await save(run, { proposalDocumentId: doc, rereadDocuments: "1" });
    expect((await save(run, { proposalDocumentId: doc, rereadDocuments: "1" })).fill).toMatchObject({ suggestionsAdded: 0 });
    const offer = (await candidates(run)).find((r) => r.candidate_text === "Test the family bundle offer")!;
    const a = await import("../objectiveCandidateActions");
    await a.rejectObjectiveCandidate(run, offer.id);
    expect((await save(run, { proposalDocumentId: doc, rereadDocuments: "1" })).fill).toMatchObject({ suggestionsAdded: 0 });
    expect((await candidates(run)).filter((r) => /family bundle/.test(r.candidate_text))).toEqual([expect.objectContaining({ status: "rejected" })]);
  });

  it("a different document fills normally", async () => {
    const run = await newRun();
    const first = await newDoc(run, "Proposal.docx");
    const other = await newDoc(run, "Brief.docx");
    intake.answers = [FIRST, "Size the opportunity in the Western Cape"];
    await save(run, { proposalDocumentId: first });
    const brief = await save(run, { briefDocumentId: other });
    expect(brief.fill).toMatchObject({ status: "filled", objectivesAdded: 1, reread: false });
    expect(brief.already).toBeNull();
    expect((await candidates(run)).find((r) => r.candidate_text === "Size the opportunity in the Western Cape")).toMatchObject({ status: "accepted" });
  });

  it("with a used proposal and a new brief, only the brief is read and the proposal is reported as already used", async () => {
    const run = await newRun();
    const proposal = await newDoc(run, "Proposal.docx");
    const brief = await newDoc(run, "Brief.docx");
    intake.answers = [FIRST, "Size the opportunity in the Western Cape"];
    await save(run, { proposalDocumentId: proposal });
    const mixed = await save(run, { proposalDocumentId: proposal, briefDocumentId: brief });
    expect(intake.calls).toBe(2);
    expect(mixed.fill).toMatchObject({ status: "filled", objectivesAdded: 1 });
    expect(mixed.already).toMatchObject({ documents: "the proposal Proposal.docx", proposalDocumentId: proposal, briefDocumentId: null });
    const used = (await db.pool.query("select detail from trace where run_id=$1 and event='brief_intake_used' order by id", [run])).rows.map((r) => r.detail);
    expect(used[1]).toMatchObject({ briefDocumentId: brief, proposalDocumentId: null });
  });

  it("typed, edited, rejected and deleted objectives are untouched by a refill and a re-read", async () => {
    const run = await newRun();
    const doc = await newDoc(run);
    intake.answers = [FIRST, REWORDED];
    await save(run, { proposalDocumentId: doc, researchObjective: "" });
    await save(run, { researchObjective: "My own typed objective" });
    const rows = await candidates(run);
    const a = await import("../objectiveCandidateActions");
    const rural = rows.find((r) => r.candidate_text.startsWith("Measure rural"))!;
    const why = rows.find((r) => r.candidate_text.startsWith("Understand why"))!;
    await a.acceptObjectiveCandidate(run, rural.id, "Measure rural bundle demand by income", rural.candidate_text);
    await a.rejectObjectiveCandidate(run, why.id);
    const typed = rows.find((r) => r.candidate_text === "My own typed objective")!;
    await a.deleteObjectiveCandidate(run, typed.id);
    const snapshot = await candidates(run);
    await save(run, { proposalDocumentId: doc });
    expect(await candidates(run)).toEqual(snapshot);
    await save(run, { proposalDocumentId: doc, rereadDocuments: "1" });
    const after = await candidates(run);
    for (const row of snapshot) expect(after).toContainEqual(row);
    expect(after.filter((r) => !snapshot.some((s) => s.id === r.id)).every((r) => r.status === "pending")).toBe(true);
    expect(after.some((r) => r.candidate_text === "My own typed objective")).toBe(false);
  });

  it("two fills of a new document at once: one fills, the other adds nothing even with different wording", async () => {
    const run = await newRun();
    const doc = await newDoc(run);
    intake.answers = [FIRST, REWORDED];
    let open!: () => void;
    intake.gate = new Promise<void>((resolve) => (open = resolve));
    const both = Promise.all([save(run, { proposalDocumentId: doc }), save(run, { proposalDocumentId: doc })]);
    await new Promise((r) => setTimeout(r, 200));
    open();
    const results = await both;
    expect(intake.calls).toBe(2);
    expect(results.filter((r) => r.fill?.status === "filled")).toHaveLength(1);
    expect(results.filter((r) => r.already !== null)).toHaveLength(1);
    // Whichever read won added its own wording; the other added nothing.
    const winner = results.find((r) => r.fill?.status === "filled")!.fill as { objectivesAdded: number };
    expect(await candidates(run)).toHaveLength(winner.objectivesAdded);
    expect(Number((await db.pool.query("select count(*) from trace where run_id=$1 and event='brief_intake_used'", [run])).rows[0].count)).toBe(1);
  });

  it("a failed re-read is reported as a re-read, keeps the typed save, and its retry reads again", async () => {
    const run = await newRun();
    const doc = await newDoc(run);
    intake.answers = [FIRST, REWORDED, REWORDED];
    await save(run, { proposalDocumentId: doc });
    intake.fail = "Synthetic model chunk outage (HTTP 503)";
    const failed = await save(run, { proposalDocumentId: doc, rereadDocuments: "1", businessProblem: "Typed during the outage" });
    expect(failed.fill).toMatchObject({ status: "failed", reread: true, proposalDocumentId: doc, recorded: true });
    expect((await db.pool.query("select business_problem from runs where id=$1", [run])).rows[0].business_problem).toBe("Typed during the outage");
    const { loadFailedBriefFill } = await import("../briefFillRecord");
    expect(await loadFailedBriefFill(tenant, run)).toMatchObject({ reread: true, proposalDocumentId: doc });
    intake.fail = null;
    const retried = await save(run, { proposalDocumentId: doc, rereadDocuments: "1" });
    expect(retried.fill).toMatchObject({ status: "filled", reread: true, suggestionsAdded: 3 });
    expect(await loadFailedBriefFill(tenant, run)).toBeNull();
  });
});
