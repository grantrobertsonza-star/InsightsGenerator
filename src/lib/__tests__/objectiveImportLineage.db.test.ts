// GT500 repairs (Codex, 2026-10-21), real database, the actual actions; only the model-backed
// extraction and scoring boundaries are controlled.
//   F01: a reread of a proposal never brings back an imported objective the researcher has since
//        edited, rejected or deleted; genuinely new source objectives are still added.
//   F02: a fill that did not happen comes back as a partial result beside the save that did, and
//        stays visible after a reload until a later fill succeeds.
//   F03: an edit is made against the wording its editor opened with; a stale or deleted target is
//        a conflict, never a new objective.
//   P01: manual Add uses the same objective identity as the fill and the scorer.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const intake = vi.hoisted(() => ({ objective: "", fail: null as string | null, calls: 0, gate: null as Promise<void> | null }));
vi.mock("../briefIntake", () => ({
  extractBriefFields: vi.fn(async () => {
    intake.calls++;
    if (intake.gate) await intake.gate;
    if (intake.fail) throw new Error(intake.fail);
    return { businessProblem: null, researchObjective: intake.objective };
  }),
}));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../objectiveValidator", () => ({ refreshObjectiveValidationQuietly: vi.fn(async () => {}) }));

describe.skipIf(!TEST_DATABASE_URL)("GT500 objective lineage, partial fills and stale edits (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic GT500')", [tenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    intake.objective = "";
    intake.fail = null;
    intake.calls = 0;
    intake.gate = null;
  });

  const newRun = async () => (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'GT500') returning id", [tenant])).rows[0].id as string;
  const newDoc = async (run: string, filename = "Independent500_Proposal.txt", text = "Proposal text") =>
    (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'evidence',$3,$4,$5) returning id", [tenant, run, filename, `${tenant}/${run}/${randomUUID()}`, text])).rows[0].id as string;
  const fill = async (run: string, proposal: string, extra: Record<string, string> = {}) => {
    const { saveRunContext } = await import("../runContextActions");
    const form = new FormData();
    form.set("businessProblem", "Typed problem");
    form.set("researchObjective", "");
    form.set("audience", "");
    form.set("proposalDocumentId", proposal);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return saveRunContext(run, form);
  };
  // Ordered by text: candidates added in one save share created_at, so creation order is not stable.
  const candidates = async (run: string) =>
    (await db.pool.query<{ id: string; candidate_text: string; status: string; rationale: string }>("select id, candidate_text, status, rationale from objective_candidates where run_id=$1 order by candidate_text, id", [run])).rows;
  const stated = async (run: string) => (await db.pool.query("select stated_objectives_text from runs where id=$1", [run])).rows[0].stated_objectives_text as string | null;

  describe("F01 import lineage", () => {
    it("an unchanged reread after an edit does not bring the original back", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Measure rural demand for affordable mobile bundles";
      expect((await fill(run, doc)).fill).toMatchObject({ status: "filled", objectivesAdded: 1 });
      const [original] = await candidates(run);
      const { editStatedObjective } = await import("../runContextActions");
      await editStatedObjective(run, original.candidate_text, "Measure rural mobile bundle demand by household income");
      const reread = await fill(run, doc);
      expect(reread).toMatchObject({ importedBefore: 1, fill: { status: "filled", objectivesAdded: 0 } });
      const after = await candidates(run);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: original.id, candidate_text: "Measure rural mobile bundle demand by household income", status: "accepted" });
      expect(after[0].rationale).toBe('Added from the proposal "Independent500_Proposal.txt"');
      expect(await stated(run)).toBe("Measure rural mobile bundle demand by household income");
    });

    it("a rejected or deleted imported objective stays out; a genuinely new one is added", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Objective kept\nObjective rejected\nObjective deleted";
      await fill(run, doc);
      const rows = await candidates(run);
      const a = await import("../objectiveCandidateActions");
      await a.rejectObjectiveCandidate(run, rows.find((r) => r.candidate_text === "Objective rejected")!.id);
      await a.deleteObjectiveCandidate(run, rows.find((r) => r.candidate_text === "Objective deleted")!.id);
      intake.objective = "Objective kept\nObjective rejected\nObjective deleted\nObjective new in the revised proposal";
      const reread = await fill(run, doc);
      expect(reread).toMatchObject({ fill: { status: "filled", objectivesAdded: 1 } });
      const after = await candidates(run);
      expect(after.map((r) => [r.candidate_text, r.status])).toEqual([
        ["Objective kept", "accepted"],
        ["Objective new in the revised proposal", "accepted"],
        ["Objective rejected", "rejected"],
      ]);
    });

    it("two documents with the same file name, and a different document repeating an imported objective", async () => {
      const run = await newRun();
      const first = await newDoc(run, "proposal.docx");
      const second = await newDoc(run, "proposal.docx");
      intake.objective = "Shared objective\nOnly in the first";
      await fill(run, first);
      const { editStatedObjective } = await import("../runContextActions");
      await editStatedObjective(run, "Shared objective", "Shared objective, reworded");
      intake.objective = "Shared objective.\nOnly in the second";
      expect(await fill(run, second)).toMatchObject({ importedBefore: 1, fill: { objectivesAdded: 1 } });
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Only in the first", "Only in the second", "Shared objective, reworded"]);
    });

    it("typed lines are not checked against the lineage: typing a deleted imported objective again adds it", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Imported then deleted";
      await fill(run, doc);
      const { editStatedObjective, saveRunContext } = await import("../runContextActions");
      await editStatedObjective(run, "Imported then deleted", null);
      const form = new FormData();
      form.set("businessProblem", "");
      form.set("researchObjective", "Imported then deleted");
      form.set("audience", "");
      expect(await saveRunContext(run, form)).toMatchObject({ importedBefore: 0, alreadyInProject: 0, fill: null });
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Imported then deleted"]);
    });

    it("concurrent fills of the same proposal add each objective once", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Concurrent objective A\nConcurrent objective B";
      await Promise.all([fill(run, doc), fill(run, doc)]);
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Concurrent objective A", "Concurrent objective B"]);
    });

    it("a fill whose save fails leaves no lineage, so the retry adds the objectives", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Objective after retry";
      await db.pool.query(
        "create or replace function gt500_fail_insert() returns trigger language plpgsql as $$ begin if new.candidate_text = 'Objective after retry' then raise exception 'synthetic insert failure'; end if; return new; end $$",
      );
      await db.pool.query("create trigger gt500_fail_insert before insert on objective_candidates for each row execute function gt500_fail_insert()");
      await expect(fill(run, doc)).rejects.toThrow("synthetic insert failure");
      await db.pool.query("drop trigger gt500_fail_insert on objective_candidates");
      expect((await db.pool.query("select count(*)::int as n from trace where run_id=$1 and event='brief_intake_used'", [run])).rows[0].n).toBe(0);
      expect(await fill(run, doc)).toMatchObject({ fill: { status: "filled", objectivesAdded: 1 } });
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Objective after retry"]);
      const { loadObjectiveSources } = await import("../briefFillRecord");
      const sources = await loadObjectiveSources(tenant, run);
      expect(sources instanceof Map && [...sources.values()]).toEqual(['Added from the proposal "Independent500_Proposal.txt"']);
    });
  });

  describe("F02 partial fills", () => {
    it("an extraction outage keeps the typed save, says the fill did not happen, and survives a reload until a retry succeeds", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Objective from the first fill";
      await fill(run, doc);
      intake.fail = "Synthetic model chunk outage (HTTP 503)";
      const result = await fill(run, doc, { businessProblem: "Manually typed problem" });
      expect(result.fill).toEqual({
        status: "failed",
        documents: "the proposal Independent500_Proposal.txt",
        reason: "Synthetic model chunk outage (HTTP 503)",
        recorded: true,
        briefDocumentId: null,
        proposalDocumentId: doc,
      });
      expect((await db.pool.query("select business_problem from runs where id=$1", [run])).rows[0].business_problem).toBe("Manually typed problem");
      const { loadFailedBriefFill, loadLastBriefFill } = await import("../briefFillRecord");
      expect(await loadFailedBriefFill(tenant, run)).toMatchObject({ documents: "the proposal Independent500_Proposal.txt", reason: "Synthetic model chunk outage (HTTP 503)", proposalDocumentId: doc });
      expect(await loadLastBriefFill(tenant, run)).toMatchObject({ objectivesAdded: 1 });
      intake.fail = null;
      intake.objective = "Objective from the first fill\nObjective from the retry";
      expect(await fill(run, doc)).toMatchObject({ fill: { status: "filled", objectivesAdded: 1 }, importedBefore: 0, alreadyInProject: 1 });
      expect(await loadFailedBriefFill(tenant, run)).toBeNull();
      expect(await fill(run, doc)).toMatchObject({ fill: { status: "filled", objectivesAdded: 0 } });
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Objective from the first fill", "Objective from the retry"]);
    });

    it("a deleted or foreign document fails visibly, naming what is known", async () => {
      const run = await newRun();
      const otherRun = await newRun();
      const foreign = await newDoc(otherRun, "foreign.docx");
      const missing = randomUUID();
      const r1 = await fill(run, foreign);
      expect(r1.fill).toMatchObject({ status: "failed", documents: "the chosen document", reason: "That document is not in this project.", recorded: true });
      const r2 = await fill(run, missing);
      expect(r2.fill).toMatchObject({ status: "failed", reason: "That document is not in this project." });
      expect(intake.calls).toBe(0);
      expect((await db.pool.query("select business_problem from runs where id=$1", [run])).rows[0].business_problem).toBe("Typed problem");
    });

    it("when the failure cannot be recorded, the response still says the fill did not happen", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.fail = "Synthetic timeout";
      await db.pool.query(
        "create or replace function gt500_fail_trace() returns trigger language plpgsql as $$ begin if new.event = 'brief_intake_error' then raise exception 'synthetic trace failure'; end if; return new; end $$",
      );
      await db.pool.query("create trigger gt500_fail_trace before insert on trace for each row execute function gt500_fail_trace()");
      try {
        const result = await fill(run, doc);
        expect(result.fill).toMatchObject({ status: "failed", reason: "Synthetic timeout", recorded: false });
      } finally {
        await db.pool.query("drop trigger gt500_fail_trace on trace");
      }
      expect((await db.pool.query("select business_problem from runs where id=$1", [run])).rows[0].business_problem).toBe("Typed problem");
    });
  });

  describe("F03 stale edits", () => {
    const setUp = async (lines: string) => {
      const run = await newRun();
      const { saveRunContext } = await import("../runContextActions");
      const form = new FormData();
      form.set("researchObjective", lines);
      await saveRunContext(run, form);
      return run;
    };

    it("two editors opened on the same wording: the second is a conflict and nothing is added", async () => {
      const run = await setUp("Understand rural demand");
      const [original] = await candidates(run);
      const { saveStatedObjectiveEdit } = await import("../runContextActions");
      expect(await saveStatedObjectiveEdit(run, "Understand rural demand", "Measure rural demand by income")).toEqual({ ok: true });
      const stale = await saveStatedObjectiveEdit(run, "Understand rural demand", "Measure rural demand by province");
      expect(stale).toMatchObject({ ok: false, conflict: true });
      expect(stale.ok === false && stale.error).toMatch(/changed or removed after you opened it/);
      expect(await candidates(run)).toEqual([expect.objectContaining({ id: original.id, candidate_text: "Measure rural demand by income", status: "accepted" })]);
      expect(await stated(run)).toBe("Measure rural demand by income");
      // Retry after the conflict, from the current wording, succeeds.
      expect(await saveStatedObjectiveEdit(run, "Measure rural demand by income", "Measure rural demand by province")).toEqual({ ok: true });
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Measure rural demand by province"]);
    });

    it("simultaneous saves of the same objective: one wins, the other conflicts", async () => {
      const run = await setUp("Same record");
      const { saveStatedObjectiveEdit } = await import("../runContextActions");
      const results = await Promise.all([saveStatedObjectiveEdit(run, "Same record", "Winner one"), saveStatedObjectiveEdit(run, "Same record", "Winner two")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.conflict)).toHaveLength(1);
      expect(await candidates(run)).toHaveLength(1);
    });

    it("simultaneous edits of different objectives both land", async () => {
      const run = await setUp("Objective one\nObjective two");
      const { saveStatedObjectiveEdit } = await import("../runContextActions");
      const results = await Promise.all([saveStatedObjectiveEdit(run, "Objective one", "Objective one, edited"), saveStatedObjectiveEdit(run, "Objective two", "Objective two, edited")]);
      expect(results).toEqual([{ ok: true }, { ok: true }]);
      expect(await stated(run)).toBe("Objective one, edited\nObjective two, edited");
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Objective one, edited", "Objective two, edited"]);
    });

    it("an objective deleted between opening and saving: Setup and Review edits are conflicts", async () => {
      const run = await setUp("Deleted meanwhile");
      const [row] = await candidates(run);
      const a = await import("../objectiveCandidateActions");
      const { saveStatedObjectiveEdit } = await import("../runContextActions");
      await a.deleteObjectiveCandidate(run, row.id);
      expect(await saveStatedObjectiveEdit(run, "Deleted meanwhile", "Edited after deletion")).toMatchObject({ ok: false, conflict: true });
      expect(await a.acceptObjectiveCandidate(run, row.id, "Edited after deletion", "Deleted meanwhile")).toMatchObject({ ok: false, conflict: true });
      expect(await candidates(run)).toEqual([]);
      expect(await stated(run)).toBeNull();
    });

    it("a Review editor opened before a Setup edit is refused; one opened after it saves", async () => {
      const run = await setUp("Set and Review");
      const [row] = await candidates(run);
      const a = await import("../objectiveCandidateActions");
      const { saveStatedObjectiveEdit } = await import("../runContextActions");
      expect(await saveStatedObjectiveEdit(run, "Set and Review", "Changed on Setup")).toEqual({ ok: true });
      expect(await a.acceptObjectiveCandidate(run, row.id, "Changed on Review", "Set and Review")).toMatchObject({ ok: false, conflict: true });
      expect((await candidates(run))[0]).toMatchObject({ id: row.id, candidate_text: "Changed on Setup" });
      expect(await a.acceptObjectiveCandidate(run, row.id, "Changed on Review", "Changed on Setup")).toEqual({ ok: true });
      expect(await stated(run)).toBe("Changed on Review");
      // And a Setup editor opened before that Review edit is refused in turn.
      expect(await saveStatedObjectiveEdit(run, "Changed on Setup", "Stale Setup edit")).toMatchObject({ ok: false, conflict: true });
      expect((await candidates(run)).map((r) => r.candidate_text)).toEqual(["Changed on Review"]);
    });
  });

  describe("P01 manual Add identity", () => {
    it("a spelling variant of an existing objective is refused with its name; a rejected one may be re-added deliberately", async () => {
      const run = await newRun();
      const doc = await newDoc(run);
      intake.objective = "Measure rural demand";
      await fill(run, doc);
      const a = await import("../objectiveCandidateActions");
      const refused = await a.addOwnObjectiveCandidate(run, "measure rural demand.");
      expect(refused).toMatchObject({ ok: false });
      expect(refused.ok === false && refused.error).toBe('Not added: "Measure rural demand" is already in this project (already accepted). Edit that one if the wording should change.');
      expect(await candidates(run)).toHaveLength(1);
      expect(await a.addOwnObjectiveCandidate(run, "Measure rural demand by province")).toEqual({ ok: true });
      const [first] = await candidates(run);
      await a.rejectObjectiveCandidate(run, first.id);
      expect(await a.addOwnObjectiveCandidate(run, "- Measure rural demand")).toEqual({ ok: true });
      const rows = (await candidates(run)).map((r) => [r.candidate_text, r.status]);
      expect(rows).toHaveLength(3);
      expect(rows).toEqual(expect.arrayContaining([
        ["Measure rural demand", "accepted"],
        ["Measure rural demand", "rejected"],
        ["Measure rural demand by province", "accepted"],
      ]));
    });

    it("concurrent spelling variants add one objective", async () => {
      const run = await newRun();
      const a = await import("../objectiveCandidateActions");
      const results = await Promise.all([a.addOwnObjectiveCandidate(run, "Concurrent add"), a.addOwnObjectiveCandidate(run, "concurrent add.")]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await candidates(run)).toHaveLength(1);
    });
  });
});
